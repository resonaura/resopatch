import {
    Background,
    ConnectionLineType,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesInitialized,
    useNodesState,
    useStoreApi,
    type Connection,
    type Edge,
    type EdgeMouseHandler,
    type Node,
    type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeRoutes, findBestPath, type EdgeRouteSpec, type Point, type RectObstacle } from '../lib/edgeRouting';

type RfHandle = { id: string | null; x: number; y: number; width: number; height: number; position: 'left' | 'right' | 'top' | 'bottom' };

import { patchCanvasEdgeTypes, patchCanvasNodeTypes } from './patchCanvasTypes';

/** Lives inside <ReactFlow> so it can read exact, per-handle pixel positions (including boundary
 *  ports proxied onto a collapsed container card) straight from the store — the same data React
 *  Flow's own built-in edges use internally. Recomputing a grid-based route is too expensive to do
 *  on every drag frame, so this only runs when `version` changes, not on every position update. */
function CableRouter({
  edges,
  version,
  onRoutes,
}: {
  edges: Edge[];
  version: number;
  onRoutes: (routes: Map<string, Point[]>) => void;
}) {
  const storeApi = useStoreApi();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    if (!nodesInitialized) return;
    const { nodeLookup } = storeApi.getState();

    const obstacles: RectObstacle[] = [];
    for (const [id, n] of nodeLookup) {
      const width = n.measured?.width ?? n.width;
      const height = n.measured?.height ?? n.height;
      if (!width || !height) continue;
      obstacles.push({ id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width, height });
    }

    /**
     * Every port has dual nipples (left + right) for both source and target. Collect all of them
     * so the router can try each side combination instead of greedily picking the closest handle
     * (which often exits the *wrong* side and then curls through neighbouring cards).
     */
    const collectPortHandles = (node: Node, handleId: string, type: 'source' | 'target'): RfHandle[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internalNode = node as any;
      const handles: RfHandle[] = (internalNode.internals?.handleBounds?.[type] ?? []) as RfHandle[];
      const baseId = handleId.replace(/-(src|tgt)-(left|right)$/, '');
      return handles.filter(
        (h) => h.id === baseId || h.id === handleId || (h.id != null && h.id.includes(baseId)),
      );
    };

    const handleCenter = (node: Node, h: RfHandle) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const abs = (node as any).internals.positionAbsolute as { x: number; y: number };
      return { x: abs.x + h.x + h.width / 2, y: abs.y + h.y + h.height / 2 };
    };

    const bestSpecs: EdgeRouteSpec[] = [];
    for (const e of edges) {
      const sourceNode = nodeLookup.get(e.source);
      const targetNode = nodeLookup.get(e.target);
      if (!sourceNode || !targetNode || !e.sourceHandle || !e.targetHandle) continue;

      const srcHandles = collectPortHandles(sourceNode, e.sourceHandle, 'source');
      const tgtHandles = collectPortHandles(targetNode, e.targetHandle, 'target');
      if (srcHandles.length === 0 || tgtHandles.length === 0) continue;

      const isPowerAdapter = (e.data as Record<string, unknown>)?.powerConverter != null;
      const candidates: EdgeRouteSpec[] = [];
      for (const sH of srcHandles) {
        const start = handleCenter(sourceNode, sH);
        const sDir = sH.position === 'left' || sH.position === 'right' ? sH.position : 'right';
        for (const tH of tgtHandles) {
          const end = handleCenter(targetNode, tH);
          const tDir = tH.position === 'left' || tH.position === 'right' ? tH.position : 'left';
          candidates.push({
            id: e.id,
            sourceNodeId: e.source,
            targetNodeId: e.target,
            start,
            end,
            sourceDir: sDir,
            targetDir: tDir,
            isPowerAdapter,
          });
        }
      }

      // Try every left/right × left/right pair; keep the clear, non-curling, shortest route.
      const { spec } = findBestPath(candidates, obstacles);
      bestSpecs.push(spec);
    }

    const routes = computeRoutes(obstacles, bestSpecs);
    onRoutes(routes);
    // Intentionally not depending on `edges`/`onRoutes` identity — recompute is gated by
    // `version` (bumped explicitly on drag / drag-stop / graph reload), not by every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized, version]);

  return null;
}

/** The reusable "obstacle-avoiding patch bay" canvas: a ReactFlow instance wired to CableRouter,
 *  live drag rerouting, and click/connect callbacks — everything Constructor.tsx's main view and
 *  ContainerInsideModal's drill-down view share verbatim. The two differ only in *which* nodes and
 *  edges they hand in (every top-level device vs. one container's direct children), not in how
 *  the canvas itself behaves. */
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
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep local RF state in sync whenever the caller's node/edge lists (re)load.
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges]);

  // Expose measured sizes callback for autoLayout
  useEffect(() => {
    if (!onGetMeasuredSizes) return;
    onGetMeasuredSizes(() => {
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const n of nodes) {
        const width = n.measured?.width ?? n.width ?? 240;
        const height = n.measured?.height ?? n.height ?? 100;
        sizes[n.id] = { width, height };
      }
      return sizes;
    });
  }, [nodes, onGetMeasuredSizes]);

  const [routes, setRoutes] = useState<Map<string, Point[]>>(new Map());
  // Cheap straight-line approximation for whichever edges touch the node currently being
  // dragged — recomputed every drag frame, but ONLY for those edges, so a drag never pays for
  // full obstacle-avoiding A* over the whole graph. Cleared on drop, once `routes` is refreshed.
  const [liveDragRoutes, setLiveDragRoutes] = useState<Map<string, Point[]>>(new Map());
  const [routeVersion, setRouteVersion] = useState(0);
  const routeRafRef = useRef<number | null>(null);
  const requestRouteRecompute = useCallback(() => {
    if (routeRafRef.current != null) return;
    routeRafRef.current = requestAnimationFrame(() => {
      routeRafRef.current = null;
      setRouteVersion((v) => v + 1);
    });
  }, []);
  useEffect(() => {
    requestRouteRecompute();
    return () => {
      if (routeRafRef.current != null) cancelAnimationFrame(routeRafRef.current);
      routeRafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges]);

  const renderEdges = useMemo(
    () => edges.map((e) => ({ ...e, data: { ...(e.data ?? {}), points: liveDragRoutes.get(e.id) ?? routes.get(e.id) } })),
    [edges, routes, liveDragRoutes],
  );

  // Throttle lightweight cable position updates during drag to stay at 60 FPS,
  // leaving full A* obstacle-avoidance routing for onNodeDragStop.
  const isDraggingRef = useRef(false);
  const handleNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      // Only the edges attached to the node being dragged need to move this frame — everything
      // else keeps its last-computed (obstacle-avoiding) path untouched until drop.
      const touching = edges.filter((e) => e.source === node.id || e.target === node.id);
      if (touching.length === 0) return;

      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      nodeById.set(node.id, node); // live position for the node actually being dragged

      const next = new Map<string, Point[]>();
      for (const e of touching) {
        const s = nodeById.get(e.source);
        const t = nodeById.get(e.target);
        if (!s || !t) continue;
        const sw = s.measured?.width ?? s.width ?? 240;
        const sh = s.measured?.height ?? s.height ?? 100;
        const tw = t.measured?.width ?? t.width ?? 240;
        const th = t.measured?.height ?? t.height ?? 100;
        const sCenter = { x: s.position.x + sw / 2, y: s.position.y + sh / 2 };
        const tCenter = { x: t.position.x + tw / 2, y: t.position.y + th / 2 };
        const sOnRight = sCenter.x <= tCenter.x;
        next.set(e.id, [
          { x: s.position.x + (sOnRight ? sw : 0), y: sCenter.y },
          { x: t.position.x + (sOnRight ? 0 : tw), y: tCenter.y },
        ]);
      }
      setLiveDragRoutes(next);
    },
    [edges, nodes],
  );

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      isDraggingRef.current = false;
      onNodeMoved(node.id, { x: node.position.x, y: node.position.y });
      setLiveDragRoutes(new Map());
      requestRouteRecompute();
    },
    [onNodeMoved, requestRouteRecompute],
  );

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => onNodeClick(node.id), [onNodeClick]);
  const handleEdgeClick: EdgeMouseHandler = useCallback((_, edge) => onEdgeClick(edge.id), [onEdgeClick]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={renderEdges}
        nodeTypes={patchCanvasNodeTypes}
        edgeTypes={patchCanvasEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={handleNodeDragStart}
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
        elevateEdgesOnSelect
      >
        <Background gap={24} />
        <Controls />
        {minimap && <MiniMap pannable zoomable />}
        <CableRouter edges={edges} version={routeVersion} onRoutes={setRoutes} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
