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
  type Node,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Table, Tabs } from '@heroui/react';
import { ChevronLeft, ChevronRight, ClipboardList, LayoutGrid, ListMusic, LogOut, Settings, Wand2 } from 'lucide-react';
import { CABLE_COLORS, CABLE_DASH, CABLE_WIDTH_SCALE, CableType, type InputListRow, type RiderRow } from '@resopatch/shared';
import { api, type GraphDevice } from '../api/client';
import DeviceNode, { type DeviceNodeData } from '../components/DeviceNode';
import RoutedEdge from '../components/RoutedEdge';
import Sidebar from '../components/Sidebar';
import Inspector, { type Selection } from '../components/Inspector';
import NewDeviceModal from '../components/NewDeviceModal';
import NewCableModal from '../components/NewCableModal';
import SettingsModal from '../components/SettingsModal';
import { computeRoutes, type EdgeRouteSpec, type Point, type RectObstacle } from '../lib/edgeRouting';

const nodeTypes = { device: DeviceNode };
const edgeTypes = { routed: RoutedEdge };

/** Lives inside <ReactFlow> so it can read exact, per-handle pixel positions (including nested
 *  ports like PowerPlant's, which share their parent's node) straight from the store — the same
 *  data React Flow's own built-in edges use internally. Recomputing a grid-based route is too
 *  expensive to do on every drag frame, so this only runs when `version` changes (drag-stop /
 *  graph reload), not on every node-position update. */
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
    (window as unknown as { __debugRouting?: unknown }).__debugRouting = { obstacles, specs, routes };
    onRoutes(routes);
    // Intentionally not depending on `edges`/`onRoutes` identity — recompute is gated by
    // `version` (bumped explicitly on drag-stop / graph reload), not by every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized, version]);

  return null;
}

export default function Constructor({ setupId, setupName }: { setupId: string; setupName: string }) {
  const qc = useQueryClient();
  const graphQuery = useQuery({ queryKey: ['graph', setupId], queryFn: () => api.getGraph(setupId) });
  const graph = graphQuery.data;

  const [selection, setSelection] = useState<Selection>(null);
  const [showNewDevice, setShowNewDevice] = useState(false);
  const [newDeviceParentId, setNewDeviceParentId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [view, setView] = useState<'canvas' | 'input-list' | 'rider'>('canvas');
  // Both side panels start collapsed — the canvas is the point of the app, the panels are tools
  // you reach for, not a permanent fixture of the layout.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, GraphDevice[]>();
    for (const d of graph?.devices ?? []) {
      if (!d.parentDeviceId) continue;
      const list = map.get(d.parentDeviceId) ?? [];
      list.push(d);
      map.set(d.parentDeviceId, list);
    }
    return map;
  }, [graph]);

  const onSelectChild = useCallback((id: string) => setSelection({ kind: 'device', id }), []);

  // The inspector is collapsed by default, but picking something on the canvas or in the
  // inventory should still surface its details rather than silently doing nothing.
  useEffect(() => {
    if (selection) setInspectorOpen(true);
  }, [selection]);

  const initialNodes: Node[] = useMemo(
    () =>
      (graph?.devices ?? [])
        // A device with a parent always nests inside that parent's card instead of getting its
        // own node — even if it has real ports of its own (e.g. a power brick strapped to a
        // pedalboard), in which case those ports render as a nested row *inside the parent's
        // card* (see DeviceNode.tsx) so their cables still have exact pixel handles to land on.
        .filter((device) => !device.parentDeviceId)
        .map((device) => ({
          id: device.id,
          type: 'device',
          position: device.position,
          data: { device, children: childrenByParent.get(device.id) ?? [], onSelectChild } satisfies DeviceNodeData,
          selected: selection?.kind === 'device' && selection.id === device.id,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, selection, childrenByParent, onSelectChild],
  );

  const portToDevice = useMemo(() => {
    const deviceById = new Map((graph?.devices ?? []).map((d) => [d.id, d]));
    // Every port lands on the nearest ancestor that actually renders as its own React Flow node
    // — i.e. walk up parentDeviceId until there isn't one — since a ported child (PowerPlant on
    // the pedalboard) no longer gets a node of its own; its Handles live inside the ancestor's.
    const topAncestorId = (device: GraphDevice): string => {
      let current = device;
      while (current.parentDeviceId) {
        const parent = deviceById.get(current.parentDeviceId);
        if (!parent) break;
        current = parent;
      }
      return current.id;
    };
    const map = new Map<string, string>();
    for (const d of graph?.devices ?? []) {
      const nodeId = topAncestorId(d);
      for (const p of d.ports) map.set(p.id, nodeId);
    }
    return map;
  }, [graph]);

  const initialEdges: Edge[] = useMemo(
    () =>
      (graph?.cables ?? []).map((cable) => ({
        id: cable.id,
        source: portToDevice.get(cable.sourcePortId) ?? '',
        sourceHandle: cable.sourcePortId,
        target: portToDevice.get(cable.targetPortId) ?? '',
        targetHandle: cable.targetPortId,
        label: cable.color ?? undefined,
        selected: selection?.kind === 'cable' && selection.id === cable.id,
        // Grid-routed: CableRouter (below) computes an obstacle-avoiding path per cable and
        // stashes it on `data.points`; RoutedEdge just draws whatever it finds there.
        type: 'routed',
        style: {
          stroke: CABLE_COLORS[cable.cableType],
          strokeWidth: (selection?.kind === 'cable' && selection.id === cable.id ? 3 : 1.5) * CABLE_WIDTH_SCALE[cable.cableType],
          strokeDasharray: CABLE_DASH[cable.cableType],
        },
        animated: cable.cableType === CableType.CONTROL_LINK,
        zIndex: selection?.kind === 'cable' && selection.id === cable.id ? 1 : 0,
      })),
    [graph, portToDevice, selection],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep local RF state in sync whenever the server graph (re)loads.
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges]);

  // Cable routes are recomputed by <CableRouter> (a grid-based A*) whenever `routeVersion`
  // changes — never on every React Flow position event directly, which fires far more often
  // than the browser can usefully repaint. `requestRouteRecompute` collapses any number of those
  // events within one animation frame into a single bump, so routing (including cables NOT
  // attached to the node being dragged, which still need to dodge it) tracks the drag live
  // instead of only snapping into place on drop.
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

  const movePosition = useMutation({
    mutationFn: (vars: { id: string; position: { x: number; y: number } }) => api.updateDevice(vars.id, { position: vars.position }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
  });

  const autoLayout = useMutation({
    mutationFn: (sizes: Record<string, { width: number; height: number }>) => api.autoLayout(setupId, sizes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
  });

  const runAutoLayout = useCallback(() => {
    // React Flow measures each node's real rendered size via ResizeObserver and reflects it
    // back onto `node.measured` — using that (instead of guessing dimensions server-side) is
    // what keeps the packed layout from overlapping nodes with more ports / longer names.
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const n of nodes) {
      const width = n.measured?.width ?? n.width;
      const height = n.measured?.height ?? n.height;
      if (width && height) sizes[n.id] = { width, height };
    }
    autoLayout.mutate(sizes);
  }, [nodes, autoLayout]);

  // Fires continuously while a node is being dragged (React Flow calls this on every pointer-move
  // frame) — throttled by requestRouteRecompute to at most one full reroute per animation frame,
  // so every cable (not just the ones attached to the node under the cursor) stays routed around
  // its current live position instead of freezing until the drag ends.
  const onNodeDrag = useCallback(() => {
    requestRouteRecompute();
  }, [requestRouteRecompute]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      movePosition.mutate({ id: node.id, position: { x: node.position.x, y: node.position.y } });
      requestRouteRecompute();
    },
    [movePosition, requestRouteRecompute],
  );

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return;
    setPendingConnection(connection);
  }, []);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => setSelection({ kind: 'device', id: node.id }), []);
  const onEdgeClick: EdgeMouseHandler = useCallback((_, edge) => setSelection({ kind: 'cable', id: edge.id }), []);
  const onPaneClick = useCallback(() => setSelection(null), []);

  if (graphQuery.isLoading) return <div className="flex h-full items-center justify-center text-default-500">Загрузка сетапа…</div>;
  if (graphQuery.isError || !graph) return <div className="flex h-full items-center justify-center text-default-500">Не удалось загрузить сетап.</div>;

  const pendingSourcePort = pendingConnection ? graph.devices.flatMap((d) => d.ports).find((p) => p.id === pendingConnection.sourceHandle) : null;
  const pendingTargetPort = pendingConnection ? graph.devices.flatMap((d) => d.ports).find((p) => p.id === pendingConnection.targetHandle) : null;
  const pendingSourceDevice = pendingConnection ? graph.devices.find((d) => d.id === pendingConnection.source) : null;
  const pendingTargetDevice = pendingConnection ? graph.devices.find((d) => d.id === pendingConnection.target) : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-default-200 bg-surface px-4 py-2">
        <h1 className="text-sm font-semibold">Resopatch</h1>
        <span className="text-xs text-default-500">{setupName}</span>
        <Tabs
          selectedKey={view}
          onSelectionChange={(key) => setView(key as typeof view)}
          variant="secondary"
          className="ml-auto"
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Вид">
              <Tabs.Tab id="canvas">
                <LayoutGrid className="h-3.5 w-3.5" />
                Схема
              </Tabs.Tab>
              <Tabs.Tab id="input-list">
                <Tabs.Separator />
                <ListMusic className="h-3.5 w-3.5" />
                Input List
              </Tabs.Tab>
              <Tabs.Tab id="rider">
                <Tabs.Separator />
                <ClipboardList className="h-3.5 w-3.5" />
                Райдер
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
        {view === 'canvas' && (
          <Button size="sm" variant="secondary" onPress={runAutoLayout} isPending={autoLayout.isPending}>
            <Wand2 className="h-3.5 w-3.5" />
            Упорядочить
          </Button>
        )}
        <Button size="sm" variant="ghost" onPress={() => setShowSettings(true)}>
          <Settings className="h-3.5 w-3.5" />
          Настройки
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onPress={async () => {
            await api.logout();
            location.reload();
          }}
        >
          <LogOut className="h-3.5 w-3.5" />
          Выйти
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className={`min-h-0 flex-none overflow-hidden transition-[width] duration-150 ${sidebarOpen ? 'w-[260px]' : 'w-0'}`}>
          <Sidebar
            devices={graph.devices}
            selectedId={selection?.kind === 'device' ? selection.id : null}
            onSelect={(id) => setSelection({ kind: 'device', id })}
            onNewDevice={() => {
              setNewDeviceParentId(null);
              setShowNewDevice(true);
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Скрыть инвентарь' : 'Показать инвентарь'}
          className="flex w-5 flex-none items-center justify-center border-r border-default-200 bg-surface text-default-500 hover:bg-surface-secondary hover:text-foreground"
        >
          {sidebarOpen ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <div className="relative min-h-0 flex-1">
          {view === 'canvas' && (
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={renderEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
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
                <MiniMap pannable zoomable />
                <CableRouter edges={edges} version={routeVersion} onRoutes={setRoutes} />
              </ReactFlow>
            </ReactFlowProvider>
          )}
          {view === 'input-list' && <InputListTable setupId={setupId} />}
          {view === 'rider' && <RiderTable setupId={setupId} />}
        </div>

        <button
          type="button"
          onClick={() => setInspectorOpen((v) => !v)}
          title={inspectorOpen ? 'Скрыть инспектор' : 'Показать инспектор'}
          className="flex w-5 flex-none items-center justify-center border-l border-default-200 bg-surface text-default-500 hover:bg-surface-secondary hover:text-foreground"
        >
          {inspectorOpen ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
        <div className={`min-h-0 flex-none overflow-hidden transition-[width] duration-150 ${inspectorOpen ? 'w-[320px]' : 'w-0'}`}>
          <Inspector
            graph={graph}
            selection={selection}
            setupId={setupId}
            onAddChild={(parentId) => {
              setNewDeviceParentId(parentId);
              setShowNewDevice(true);
            }}
            onSelectDevice={(id) => setSelection({ kind: 'device', id })}
          />
        </div>
      </div>
      {showNewDevice && (
        <NewDeviceModal setupId={setupId} defaultParentId={newDeviceParentId} onClose={() => setShowNewDevice(false)} />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {pendingConnection && pendingSourcePort && pendingTargetPort && pendingSourceDevice && pendingTargetDevice && (
        <NewCableModal
          setupId={setupId}
          sourcePortId={pendingSourcePort.id}
          targetPortId={pendingTargetPort.id}
          sourcePort={pendingSourcePort}
          targetPort={pendingTargetPort}
          sourceDeviceName={pendingSourceDevice.name}
          targetDeviceName={pendingTargetDevice.name}
          onClose={() => setPendingConnection(null)}
        />
      )}
    </div>
  );
}

function InputListTable({ setupId }: { setupId: string }) {
  const query = useQuery({ queryKey: ['input-list', setupId], queryFn: () => api.getInputList(setupId) });
  if (query.isLoading) return <div className="overflow-auto p-4 text-sm text-default-500">Загрузка…</div>;
  if (query.isError || !query.data) return <div className="overflow-auto p-4 text-sm text-default-500">Ошибка загрузки.</div>;

  const columns: { key: keyof InputListRow; label: string }[] = [
    { key: 'channel', label: 'CH' },
    { key: 'sourceName', label: 'Источник' },
    { key: 'connector', label: 'Разъём' },
    { key: 'routing', label: 'Маршрут' },
    { key: 'zone', label: 'Зона' },
    { key: 'owner', label: 'Владелец' },
  ];

  return (
    <div className="min-h-0 overflow-auto p-4">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Input list">
            <Table.Header>
              {columns.map((c) => (
                <Table.Column key={c.key}>{c.label}</Table.Column>
              ))}
            </Table.Header>
            <Table.Body>
              {query.data.map((r) => (
                <Table.Row key={r.channel}>
                  {columns.map((c) => (
                    <Table.Cell key={c.key}>{String(r[c.key])}</Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

function RiderTable({ setupId }: { setupId: string }) {
  const query = useQuery({ queryKey: ['rider', setupId], queryFn: () => api.getRider(setupId) });
  if (query.isLoading) return <div className="overflow-auto p-4 text-sm text-default-500">Загрузка…</div>;
  if (query.isError || !query.data) return <div className="overflow-auto p-4 text-sm text-default-500">Ошибка загрузки.</div>;

  return (
    <div className="min-h-0 overflow-auto p-4">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Rider">
            <Table.Header>
              <Table.Column>Категория</Table.Column>
              <Table.Column>Наименование</Table.Column>
              <Table.Column>Кол-во</Table.Column>
              <Table.Column>Чьё</Table.Column>
              <Table.Column>Заметка</Table.Column>
            </Table.Header>
            <Table.Body>
              {query.data.map((r: RiderRow, i: number) => (
                <Table.Row key={i}>
                  <Table.Cell>{r.category}</Table.Cell>
                  <Table.Cell>{r.name}</Table.Cell>
                  <Table.Cell>{r.quantity}</Table.Cell>
                  <Table.Cell>{r.isUserOwned ? 'наше' : 'площадка'}</Table.Cell>
                  <Table.Cell>{r.note ?? ''}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}
