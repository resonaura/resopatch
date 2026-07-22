import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import DeviceNode from './DeviceNode';
import RoutedEdge from './RoutedEdge';
import { computeRoutes, type EdgeRouteSpec, type Point, type RectObstacle } from '../lib/edgeRouting';

export const patchCanvasNodeTypes = { device: DeviceNode };
export const patchCanvasEdgeTypes = { routed: RoutedEdge };

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

    const specs: EdgeRouteSpec[] = [];
    for (const e of edges) {
      const sourceNode = nodeLookup.get(e.source);
      const targetNode = nodeLookup.get(e.target);
      if (!sourceNode || !targetNode || !e.sourceHandle || !e.targetHandle) continue;
      const sHandle = sourceNode.internals.handleBounds?.source?.find((h) => h.id === e.sourceHandle);
      const tHandle = targetNode.internals.handleBounds?.target?.find((h) => h.id === e.targetHandle);
      if (!sHandle || !tHandle) continue;
      const start = {
        x: sourceNode.internals.positionAbsolute.x + sHandle.x + sHandle.width,
        y: sourceNode.internals.positionAbsolute.y + sHandle.y + sHandle.height / 2,
      };
      const end = {
        x: targetNode.internals.positionAbsolute.x + tHandle.x,
        y: targetNode.internals.positionAbsolute.y + tHandle.y + tHandle.height / 2,
      };
      specs.push({ id: e.id, sourceNodeId: e.source, targetNodeId: e.target, start, end });
    }

    const routes = computeRoutes(obstacles, specs);
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
  minimap = true,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (id: string) => void;
  onEdgeClick: (id: string) => void;
  onPaneClick: () => void;
  onConnect: (connection: Connection) => void;
  onNodeMoved: (id: string, position: { x: number; y: number }) => void;
  minimap?: boolean;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep local RF state in sync whenever the caller's node/edge lists (re)load.
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges]);

  // Cable routes are recomputed by CableRouter (a grid-based A*) whenever `routeVersion` changes
  // — never on every React Flow position event directly, which fires far more often than the
  // browser can usefully repaint. `requestRouteRecompute` collapses any number of those events
  // within one animation frame into a single bump, so routing (including cables NOT attached to
  // the node being dragged, which still need to dodge it) tracks the drag live instead of only
  // snapping into place on drop.
  const [routes, setRoutes] = useState<Map<string, Point[]>>(new Map());
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

  const renderEdges = useMemo(() => edges.map((e) => ({ ...e, data: { ...(e.data ?? {}), points: routes.get(e.id) } })), [edges, routes]);

  // Fires continuously while a node is being dragged (React Flow calls this on every pointer-move
  // frame) — throttled by requestRouteRecompute to at most one full reroute per animation frame.
  const handleNodeDrag = useCallback(() => requestRouteRecompute(), [requestRouteRecompute]);
  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      onNodeMoved(node.id, { x: node.position.x, y: node.position.y });
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
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.02, maxZoom: 1 }}
        minZoom={0.02}
        maxZoom={2}
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
