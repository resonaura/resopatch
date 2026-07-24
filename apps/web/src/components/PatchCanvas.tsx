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
import { applyCableManagement, type EdgePortMeta } from '../lib/cableManage';
import { findLabelPoint, type Point } from '../lib/edgeRouting';
import {
    isPsuObstacleId,
    pickBestNipplePath,
    toRoutingEdges,
    toRoutingNodesWithNippleWalls,
} from '../lib/nippleRouting';
import { enforceOrthogonal, nudgeParallelRuns } from '../lib/nudgeParallel';
import { pathHitsNodeBodies, type NodeBox } from '../lib/pathAvoidNodes';
import {
    basePortId,
    pickNearestSourceHandle,
    pickNearestTargetHandle,
} from '../lib/portHandles';
import { logAllRoutes } from '../lib/routeDebugLog';
import { buildSimpleOrthoPath } from '../lib/simpleOrtho';
import { svgPathToPoints } from '../lib/svgPathToPoints';
import {
    edgeIdFromPsuCard,
    PSU_CARD_H,
    PSU_CARD_W,
    PSU_Z_INDEX,
    psuCardIdForEdge,
    type PowerAdapterNodeData,
} from './PowerAdapterNode';
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
  layoutSyncKey,
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
  /** Bumps on Arrange so we re-apply positions even if RF held a drag mid-flight. */
  layoutSyncKey: number;
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

  /**
   * Sync props → RF store. Must be useEffect (not useMemo): after Arrange the parent
   * pushes new positions; we keep measured sizes from the previous RF nodes so layout
   * height doesn't collapse, but always take position/data from props.
   */
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return initialNodes.map((n) => {
        const old = prevById.get(n.id);
        if (!old) return n;
        return {
          ...n,
          position: { x: n.position.x, y: n.position.y },
          measured: old.measured,
          width: old.width ?? n.width,
          height: old.height ?? n.height,
          selected: n.selected,
        };
      });
    });
    setEdges(withNearestNipples(initialEdges, initialNodes));
    // layoutSyncKey: force re-apply after Arrange even if positions deep-equal mid-race.
  }, [initialNodes, initialEdges, layoutSyncKey, setNodes, setEdges]);

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

  // Inline PSU cards: real RF nodes (collision with other cards) + soft obstacles
  // for foreign cables. Not fed into WASM (own power net must still run under its card).
  const [psuNodes, setPsuNodes] = useState<Node[]>([]);

  // Real cards + virtual mid-card walls (block L→R body tunnels in libavoid).
  const routingNodes = useMemo(() => {
    const real = nodes.filter((n) => !isPsuObstacleId(n.id));
    return toRoutingNodesWithNippleWalls(real);
  }, [nodes]);
  const routingEdges = useMemo(() => toRoutingEdges(edges), [edges]);

  const { updateRoutingOnNodesChange, refreshRouting } = useAvoidNodesRouterFromWorker(
    routingNodes,
    routingEdges,
    {
      // Mild clearance — large buffers make libavoid hug far detours past unrelated cards.
      edgeToNodeSpacing: 12,
      edgeToEdgeSpacing: 8,
      edgeRounding: 0,
      diagramGridSize: 0,
      // We own L/R via dual scorer + sticky handles; don't let WASM flip sides under us.
      autoBestSideConnection: false,
      shouldSplitEdgesNearHandle: false,
      debounceMs: 40,
    },
  );

  const avoidRoutes = useAvoidRoutesStore((s) => s.routes);
  const [routes, setRoutes] = useState<Map<string, Point[]>>(new Map());
  const handleFixRef = useRef(false);
  /** Coalesce drag re-routes to one rAF — same full pipeline as drag-stop. */
  const dragRouteRafRef = useRef(0);

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
    const meta: EdgePortMeta[] = [];
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
        meta.push({
          edgeId: e.id,
          sourceId: e.source,
          targetId: e.target,
          sourceSide: best.sourceSide,
          targetSide: best.targetSide,
        });
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

    // 1) Comb stubs + keep clear detours (never collapse highways into body L/Z).
    // 2) Pack collinear same-angle runs with node clearance.
    //
    // PSU ownership: each inline PSU card is "owned" by its parent power edge so that
    // edge never sees the card as an obstacle (cable runs under the badge). Every other
    // edge treats those cards as solid keep-outs.
    const ownByEdge = new Map<string, Set<string>>();
    for (const m of meta) {
      ownByEdge.set(m.edgeId, new Set([m.sourceId, m.targetId]));
    }
    const managed = applyCableManagement(next, meta, boxes);
    const packed = nudgeParallelRuns(managed, 16, boxes, ownByEdge);
    let finalRoutes = new Map<string, Point[]>();
    for (const [id, pts] of packed) {
      finalRoutes.set(id, enforceOrthogonal(pts));
    }

    // --- Inline PSU cards as real nodes (above copper, avoid other nets) ---
    const metaById = new Map(meta.map((m) => [m.edgeId, m]));
    const rectObstacles = boxes.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }));
    const adapterBoxes: NodeBox[] = [];
    const nextPsu: Node[] = [];
    for (const e of edges) {
      const pc = (e.data as { powerConverter?: PowerAdapterNodeData | null } | undefined)
        ?.powerConverter;
      const pts = finalRoutes.get(e.id);
      if (!pc || !pts || pts.length < 2) continue;
      const fallback = {
        x: (pts[0].x + pts[pts.length - 1].x) / 2,
        y: (pts[0].y + pts[pts.length - 1].y) / 2,
      };
      const mid = findLabelPoint(pts, rectObstacles, fallback);
      const id = psuCardIdForEdge(e.id);
      const box: NodeBox = {
        id,
        x: Math.round(mid.x - PSU_CARD_W / 2),
        y: Math.round(mid.y - PSU_CARD_H / 2),
        width: PSU_CARD_W,
        height: PSU_CARD_H,
      };
      // Nudge off overlapping device bodies (card is a real node — no stacking on chips).
      for (const d of boxes) {
        const overlapX =
          box.x < d.x + d.width + 8 && box.x + box.width + 8 > d.x;
        const overlapY =
          box.y < d.y + d.height + 8 && box.y + box.height + 8 > d.y;
        if (!overlapX || !overlapY) continue;
        box.y = Math.round(d.y + d.height + 16);
      }
      adapterBoxes.push(box);
      // Own power edge must NOT treat this card as an obstacle.
      const own = ownByEdge.get(e.id) ?? new Set<string>();
      own.add(id);
      ownByEdge.set(e.id, own);

      nextPsu.push({
        id,
        type: 'powerAdapter',
        position: { x: box.x, y: box.y },
        width: PSU_CARD_W,
        height: PSU_CARD_H,
        measured: { width: PSU_CARD_W, height: PSU_CARD_H },
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        zIndex: PSU_Z_INDEX,
        data: {
          fromVoltage: pc.fromVoltage ?? '120V AC',
          toVoltage: pc.toVoltage,
          adapterName: pc.adapterName,
          dcColor: pc.dcColor,
          edgeId: e.id,
        } satisfies PowerAdapterNodeData,
      });
    }

    if (adapterBoxes.length > 0) {
      const detoured = new Map(finalRoutes);

      for (const [id, pts] of finalRoutes) {
        // Foreign PSUs only — never the card that belongs to this cable.
        const foreignPsu = adapterBoxes.filter((b) => edgeIdFromPsuCard(b.id) !== id);
        if (foreignPsu.length === 0) continue;
        if (!pathHitsNodeBodies(pts, foreignPsu, 8)) continue;

        const m = metaById.get(id);
        if (!m || pts.length < 2) continue;
        const sBox = boxes.find((b) => b.id === m.sourceId) ?? null;
        const tBox = boxes.find((b) => b.id === m.targetId) ?? null;
        // Device boxes + foreign PSUs. Own PSU is NOT in the list.
        const obstacles = [...boxes, ...foreignPsu];

        let best: Point[] | null = null;
        let bestLen = Infinity;
        const consider = (cand: Point[] | null) => {
          if (!cand || cand.length < 2) return;
          if (pathHitsNodeBodies(cand, foreignPsu, 8)) return;
          if (pathHitsNodeBodies(cand, boxes.filter((b) => b.id !== m.sourceId && b.id !== m.targetId), 4))
            return;
          const ortho = enforceOrthogonal(cand);
          let len = 0;
          for (let i = 0; i < ortho.length - 1; i++) {
            len += Math.hypot(ortho[i + 1].x - ortho[i].x, ortho[i + 1].y - ortho[i].y);
          }
          if (len < bestLen) {
            bestLen = len;
            best = ortho;
          }
        };

        for (const pad of [0, 4, 8, 12]) {
          consider(
            buildSimpleOrthoPath(
              pts[0],
              pts[pts.length - 1],
              m.sourceSide,
              m.targetSide,
              sBox,
              tBox,
              obstacles,
              m.sourceId,
              m.targetId,
              28,
              pad,
            ),
          );
        }
        // Ring highways around each foreign PSU.
        for (const psu of foreignPsu) {
          const ring = [
            psu.y - 28,
            psu.y + psu.height + 28,
            psu.x - 28,
            psu.x + psu.width + 28,
          ];
          // Horizontal rings
          for (const cy of [ring[0], ring[1]]) {
            consider([
              pts[0],
              { x: pts[0].x, y: cy },
              { x: pts[pts.length - 1].x, y: cy },
              pts[pts.length - 1],
            ]);
          }
          // Vertical rings then into target
          for (const cx of [ring[2], ring[3]]) {
            consider([
              pts[0],
              { x: cx, y: pts[0].y },
              { x: cx, y: pts[pts.length - 1].y },
              pts[pts.length - 1],
            ]);
          }
        }
        if (best) detoured.set(id, best);
      }

      // Cable-manage on *device* boxes only — never pass own/foreign PSU here
      // (applyCableManagement treats unknown ids as foreign and panics own power net).
      const managed2 = applyCableManagement(detoured, meta, boxes);
      // Pack: allBoxes + ownByEdge so each power net ignores only its own PSU id.
      const allBoxes = [...boxes, ...adapterBoxes];
      const packed2 = nudgeParallelRuns(managed2, 16, allBoxes, ownByEdge);
      finalRoutes = new Map<string, Point[]>();
      for (const [id, pts] of packed2) {
        const foreignPsu = adapterBoxes.filter((b) => edgeIdFromPsuCard(b.id) !== id);
        if (foreignPsu.length && pathHitsNodeBodies(pts, foreignPsu, 8)) {
          const prev = detoured.get(id) ?? finalRoutes.get(id) ?? pts;
          finalRoutes.set(id, enforceOrthogonal(prev));
        } else {
          finalRoutes.set(id, enforceOrthogonal(pts));
        }
      }

      // Re-seat each PSU on its *own* path midpoint so the badge stays on its cable
      // after foreign nets detoured away.
      for (const n of nextPsu) {
        const edgeId = (n.data as PowerAdapterNodeData).edgeId;
        const pts = finalRoutes.get(edgeId);
        if (!pts || pts.length < 2) continue;
        const mid = findLabelPoint(pts, rectObstacles, {
          x: (pts[0].x + pts[pts.length - 1].x) / 2,
          y: (pts[0].y + pts[pts.length - 1].y) / 2,
        });
        n.position = {
          x: Math.round(mid.x - PSU_CARD_W / 2),
          y: Math.round(mid.y - PSU_CARD_H / 2),
        };
      }
    }

    setRoutes(finalRoutes);
    setPsuNodes(nextPsu);

    // Debug dump — open DevTools console, copy FULL_JSON or call __resopatchCopyRouteDump().
    logAllRoutes({
      nodes: [
        ...boxes.map((b) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const n = nodeLookup.get(b.id) as any;
          const label =
            typeof n?.data?.label === 'string'
              ? n.data.label
              : typeof n?.data?.device?.name === 'string'
                ? n.data.device.name
                : b.id;
          return { id: b.id, x: b.x, y: b.y, width: b.width, height: b.height, label };
        }),
        ...adapterBoxes.map((b) => ({
          id: b.id,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          label: 'PSU',
        })),
      ],
      edges: edges
        .filter((e) => finalRoutes.has(e.id))
        .map((e) => {
          const m = metaById.get(e.id);
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            sourceSide: m?.sourceSide,
            targetSide: m?.targetSide,
            picked: next.get(e.id),
            managed: managed.get(e.id),
            packed: packed.get(e.id),
            final: finalRoutes.get(e.id) ?? [],
          };
        }),
    });

    // Snap RF handles to the geometrically nearer nipples when scorer disagrees.
    // Guard against update loops: only write when something actually changes.
    if (handleFixes.length > 0 && !handleFixRef.current) {
      handleFixRef.current = true;
      setEdges((prev) => {
        let changed = false;
        const nextEdges = prev.map((e) => {
          const fix = handleFixes.find((f) => f.id === e.id);
          if (!fix) return e;
          if (fix.sourceHandle === e.sourceHandle && fix.targetHandle === e.targetHandle) return e;
          changed = true;
          return { ...e, sourceHandle: fix.sourceHandle, targetHandle: fix.targetHandle };
        });
        return changed ? nextEdges : prev;
      });
      // Allow another fix after RF re-routes with the new handles.
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
          // Same dual-nipple + cable-manage routes as after drop (no straight-line drag stub).
          points: routes.get(e.id),
          // Prefer real PSU node over floating edge label when we materialized one.
          psuAsNode: psuNodes.some((n) => n.id === psuCardIdForEdge(e.id)),
        },
      })),
    [edges, routes, psuNodes],
  );

  /** Device nodes + inline PSU cards (real RF nodes for collision / hit-testing). */
  const displayNodes = useMemo(() => {
    const real = nodes.filter((n) => !isPsuObstacleId(n.id));
    return [...real, ...psuNodes];
  }, [nodes, psuNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChangeBase(changes);
      // Libavoid worker: same path as idle / after drop.
      updateRoutingOnNodesChange(changes);
    },
    [onNodesChangeBase, updateRoutingOnNodesChange],
  );

  /**
   * During drag: same algorithm as drop — nearest L/R nipples + full worker refresh.
   * Coalesced to one frame so we don't thrash WASM on every pointer sample.
   */
  const handleNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      if (dragRouteRafRef.current) return;
      dragRouteRafRef.current = requestAnimationFrame(() => {
        dragRouteRafRef.current = 0;
        const liveNodes = storeApi.getState().nodes as Node[];
        const merged = liveNodes.map((n) =>
          n.id === node.id ? { ...n, position: node.position } : n,
        );
        setEdges((prev) => withNearestNipples(prev, merged));
        refreshRouting();
      });
    },
    [storeApi, setEdges, refreshRouting],
  );

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (dragRouteRafRef.current) {
        cancelAnimationFrame(dragRouteRafRef.current);
        dragRouteRafRef.current = 0;
      }
      onNodeMoved(node.id, { x: node.position.x, y: node.position.y });
      // Final snap: same nipple pick + full re-route as during drag (ensures settle).
      const liveNodes = storeApi.getState().nodes as Node[];
      const merged = liveNodes.map((n) =>
        n.id === node.id ? { ...n, position: node.position } : n,
      );
      setEdges((prev) => withNearestNipples(prev, merged));
      refreshRouting();
    },
    [onNodeMoved, refreshRouting, storeApi, setEdges],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      if (isPsuObstacleId(node.id)) return;
      onNodeClick(node.id);
    },
    [onNodeClick],
  );
  const handleEdgeClick: EdgeMouseHandler = useCallback((_, edge) => onEdgeClick(edge.id), [onEdgeClick]);

  // Don't feed PSU position changes into drag-save / device updates.
  const onNodesChangeSafe = useCallback(
    (changes: NodeChange<Node>[]) => {
      const filtered = changes.filter((c) => {
        if (c.type === 'position' || c.type === 'dimensions' || c.type === 'select' || c.type === 'remove') {
          const id = 'id' in c ? c.id : '';
          if (id && isPsuObstacleId(id)) return false;
        }
        return true;
      });
      if (filtered.length === 0) return;
      onNodesChange(filtered);
    },
    [onNodesChange],
  );

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={renderEdges}
      nodeTypes={patchCanvasNodeTypes}
      edgeTypes={patchCanvasEdgeTypes}
      onNodesChange={onNodesChangeSafe}
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
      // Never lift edges over nodes — PSU cards and devices must stay above copper.
      elevateEdgesOnSelect={false}
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
  layoutSyncKey = 0,
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
  layoutSyncKey?: number;
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
        layoutSyncKey={layoutSyncKey}
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
