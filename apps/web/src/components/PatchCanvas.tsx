import {
    Background,
    ConnectionLineType,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useStoreApi,
    type Connection,
    type Edge,
    type EdgeMouseHandler,
    type Node,
    type NodeChange,
    type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAvoidNodesRouterFromWorker, useAvoidRoutesStore } from 'avoid-nodes-edge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '../lib/edgeRouting';
import {
    pickBestNipplePath,
    toRoutingEdges,
    toRoutingNodesWithNippleWalls,
} from '../lib/nippleRouting';
import type { NodeBox } from '../lib/pathAvoidNodes';
import {
    basePortId,
    pickNearestSourceHandle,
    pickNearestTargetHandle,
} from '../lib/portHandles';
import { svgPathToPoints } from '../lib/svgPathToPoints';
import { patchCanvasEdgeTypes, patchCanvasNodeTypes } from './patchCanvasTypes';

function nodeCenter(n: Node): { x: number; y: number } {
  const w = n.measured?.width ?? n.width ?? 240;
  const h = n.measured?.height ?? n.height ?? 100;
  return { x: n.position.x + w / 2, y: n.position.y + h / 2 };
}

/** Initial geometric L/R guess (WASM + dual-path scorer refine after route). */
function withNearestNipples(edges: Edge[], nodes: Node[]): Edge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((e) => {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t || !e.sourceHandle || !e.targetHandle) return e;
    const sc = nodeCenter(s);
    const tc = nodeCenter(t);
    const src = pickNearestSourceHandle(e.sourceHandle, sc.x, tc.x);
    const tgt = pickNearestTargetHandle(e.targetHandle, sc.x, tc.x);
    return { ...e, sourceHandle: src.id, targetHandle: tgt.id };
  });
}

/**
 * Inner canvas: needs ReactFlow store for exact handle bounds (nipple pixels).
 */
function PatchCanvasInner({
  initialNodes,
  initialEdges,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onConnect,
  onNodeMoved,
  onGetMeasuredSizes,
  minimap,
  fitPadding,
}: {
  initialNodes: Node[];
  initialEdges: Edge[];
  onNodeClick: (id: string) => void;
  onEdgeClick: (id: string) => void;
  onPaneClick: () => void;
  onConnect: (connection: Connection) => void;
  onNodeMoved: (id: string, position: { x: number; y: number }) => void;
  onGetMeasuredSizes?: (getter: () => Record<string, { width: number; height: number }>) => void;
  minimap: boolean;
  fitPadding?: number;
}) {
  // Resolve dual handles once positions are known so RF + libavoid use facing nipples.
  const edgesWithNipples = useMemo(
    () => withNearestNipples(initialEdges, initialNodes),
    [initialEdges, initialNodes],
  );

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(edgesWithNipples);
  const storeApi = useStoreApi();

  useMemo(() => {
    setNodes(initialNodes);
    setEdges(withNearestNipples(initialEdges, initialNodes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges]);

  useEffect(() => {
    if (!onGetMeasuredSizes) return;
    onGetMeasuredSizes(() => {
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const n of nodes) {
        sizes[n.id] = {
          width: n.measured?.width ?? n.width ?? 240,
          height: n.measured?.height ?? n.height ?? 100,
        };
      }
      return sizes;
    });
  }, [nodes, onGetMeasuredSizes]);

  // Re-pick nipples when live positions change (drag), without thrashing on selection-only updates.
  const nippleKey = useMemo(() => {
    return nodes
      .map((n) => `${n.id}:${Math.round(n.position.x)}:${Math.round(n.position.y)}`)
      .sort()
      .join('|');
  }, [nodes]);

  const lastNippleKey = useRef('');
  useEffect(() => {
    if (nippleKey === lastNippleKey.current) return;
    lastNippleKey.current = nippleKey;
    setEdges((prev) => withNearestNipples(prev, nodes));
  }, [nippleKey, nodes, setEdges]);

  // Real cards + virtual mid-card walls (block L→R body tunnels in libavoid).
  const routingNodes = useMemo(() => toRoutingNodesWithNippleWalls(nodes), [nodes]);
  const routingEdges = useMemo(() => toRoutingEdges(edges), [edges]);

  const { updateRoutingOnNodesChange, refreshRouting } = useAvoidNodesRouterFromWorker(
    routingNodes,
    routingEdges,
    {
      edgeToNodeSpacing: 18,
      edgeToEdgeSpacing: 12,
      edgeRounding: 0,
      diagramGridSize: 0,
      // We pick L/R via dual-path scoring; keep auto side as extra freedom for mid pins.
      autoBestSideConnection: true,
      shouldSplitEdgesNearHandle: true,
      debounceMs: 40,
    },
  );

  const avoidRoutes = useAvoidRoutesStore((s) => s.routes);
  const [routes, setRoutes] = useState<Map<string, Point[]>>(new Map());
  const [liveDragRoutes, setLiveDragRoutes] = useState<Map<string, Point[]>>(new Map());
  const handleFixRef = useRef(false);

  // Dual-nipple score: try L/R × L/R snaps on the WASM mid-path, keep the clear one.
  useEffect(() => {
    const { nodeLookup } = storeApi.getState();
    const boxes: NodeBox[] = [];
    for (const [id, n] of nodeLookup) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const node = n as any;
      const w = node.measured?.width ?? node.width;
      const h = node.measured?.height ?? node.height;
      if (!w || !h) continue;
      const abs = node.internals?.positionAbsolute ?? node.position;
      boxes.push({ id, x: abs.x, y: abs.y, width: w, height: h });
    }

    const next = new Map<string, Point[]>();
    const handleFixes: { id: string; sourceHandle: string; targetHandle: string }[] = [];

    for (const e of edges) {
      const route = avoidRoutes[e.id];
      if (!route?.path || !e.sourceHandle || !e.targetHandle) continue;

      const wasmPts = svgPathToPoints(route.path);
      if (wasmPts.length < 2) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sNode = nodeLookup.get(e.source) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tNode = nodeLookup.get(e.target) as any;
      if (!sNode || !tNode) {
        next.set(e.id, wasmPts);
        continue;
      }

      const best = pickBestNipplePath(
        wasmPts,
        sNode,
        tNode,
        e.sourceHandle,
        e.targetHandle,
        boxes,
      );

      if (best) {
        next.set(e.id, best.path);
        if (best.sourceHandle !== e.sourceHandle || best.targetHandle !== e.targetHandle) {
          handleFixes.push({
            id: e.id,
            sourceHandle: best.sourceHandle,
            targetHandle: best.targetHandle,
          });
        }
      } else {
        next.set(e.id, wasmPts);
      }
    }

    setRoutes(next);

    // Apply better handle ids once (avoid loop).
    if (handleFixes.length > 0 && !handleFixRef.current) {
      handleFixRef.current = true;
      setEdges((prev) =>
        prev.map((e) => {
          const fix = handleFixes.find((f) => f.id === e.id);
          return fix
            ? { ...e, sourceHandle: fix.sourceHandle, targetHandle: fix.targetHandle }
            : e;
        }),
      );
      // Allow future fixes after the next full route result.
      requestAnimationFrame(() => {
        handleFixRef.current = false;
      });
    }
  }, [avoidRoutes, edges, storeApi, setEdges]);

  const layoutKey = useMemo(() => {
    const nodePart = initialNodes
      .map((n) => `${n.id}:${Math.round(n.position.x)}:${Math.round(n.position.y)}`)
      .sort()
      .join('|');
    const edgePart = initialEdges
      .map((e) => `${e.id}:${e.source}:${e.target}:${basePortId(e.sourceHandle)}:${basePortId(e.targetHandle)}`)
      .sort()
      .join('|');
    return `${nodePart}#${edgePart}`;
  }, [initialNodes, initialEdges]);

  const lastLayoutKeyRef = useRef('');
  useEffect(() => {
    if (layoutKey === lastLayoutKeyRef.current) return;
    lastLayoutKeyRef.current = layoutKey;
    const t = window.setTimeout(() => refreshRouting(), 60);
    return () => window.clearTimeout(t);
  }, [layoutKey, refreshRouting]);

  const renderEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        data: {
          ...(e.data ?? {}),
          points: liveDragRoutes.get(e.id) ?? routes.get(e.id),
        },
      })),
    [edges, routes, liveDragRoutes],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChangeBase(changes);
      updateRoutingOnNodesChange(changes);
    },
    [onNodesChangeBase, updateRoutingOnNodesChange],
  );

  const handleNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      const touching = edges.filter((e) => e.source === node.id || e.target === node.id);
      if (touching.length === 0) return;

      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      nodeById.set(node.id, node);

      const next = new Map<string, Point[]>();
      for (const e of touching) {
        const s = nodeById.get(e.source);
        const t = nodeById.get(e.target);
        if (!s || !t) continue;
        const sc = nodeCenter(s);
        const tc = nodeCenter(t);
        const sOnRight = sc.x <= tc.x;
        const sw = s.measured?.width ?? s.width ?? 240;
        const tw = t.measured?.width ?? t.width ?? 240;
        next.set(e.id, [
          { x: s.position.x + (sOnRight ? sw : 0), y: sc.y },
          { x: t.position.x + (sOnRight ? 0 : tw), y: tc.y },
        ]);
      }
      setLiveDragRoutes(next);
    },
    [edges, nodes],
  );

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      onNodeMoved(node.id, { x: node.position.x, y: node.position.y });
      setLiveDragRoutes(new Map());
      // Re-pick facing nipples after drop, then re-route.
      setEdges((prev) => withNearestNipples(prev, nodes.map((n) => (n.id === node.id ? node : n))));
      refreshRouting();
    },
    [onNodeMoved, refreshRouting, nodes, setEdges],
  );

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => onNodeClick(node.id), [onNodeClick]);
  const handleEdgeClick: EdgeMouseHandler = useCallback((_, edge) => onEdgeClick(edge.id), [onEdgeClick]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={renderEdges}
      nodeTypes={patchCanvasNodeTypes}
      edgeTypes={patchCanvasEdgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDrag={handleNodeDrag}
      onNodeDragStop={handleNodeDragStop}
      onConnect={onConnect}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onPaneClick={onPaneClick}
      fitView
      fitViewOptions={{ padding: fitPadding ?? 0.15, minZoom: 0.45, maxZoom: 1.1 }}
      minZoom={0.15}
      maxZoom={2.5}
      colorMode="dark"
      connectionLineType={ConnectionLineType.SmoothStep}
      // Don't lift every edge above nodes — copper stays under cards; select still elevates one.
      elevateEdgesOnSelect
    >
      <Background gap={24} />
      <Controls />
      {minimap && <MiniMap pannable zoomable />}
    </ReactFlow>
  );
}

/**
 * Patch canvas: React Flow + avoid-nodes-edge (libavoid WASM in a Web Worker).
 * Provider wraps the inner canvas so handle bounds are available for nipple snap.
 */
export default function PatchCanvas({
  nodes: initialNodes,
  edges: initialEdges,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onConnect,
  onNodeMoved,
  onGetMeasuredSizes,
  minimap = true,
  fitPadding,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (id: string) => void;
  onEdgeClick: (id: string) => void;
  onPaneClick: () => void;
  onConnect: (connection: Connection) => void;
  onNodeMoved: (id: string, position: { x: number; y: number }) => void;
  onGetMeasuredSizes?: (getter: () => Record<string, { width: number; height: number }>) => void;
  minimap?: boolean;
  fitPadding?: number;
}) {
  return (
    <ReactFlowProvider>
      <PatchCanvasInner
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        onNodeMoved={onNodeMoved}
        onGetMeasuredSizes={onGetMeasuredSizes}
        minimap={minimap}
        fitPadding={fitPadding}
      />
    </ReactFlowProvider>
  );
}
