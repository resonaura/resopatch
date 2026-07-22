import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  ConnectionLineType,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Table, Tabs } from '@heroui/react';
import { ClipboardList, LayoutGrid, ListMusic, LogOut, Settings, Wand2 } from 'lucide-react';
import { CABLE_COLORS, CableType, type InputListRow, type RiderRow } from '@resopatch/shared';
import { api, type GraphDevice } from '../api/client';
import DeviceNode, { type DeviceNodeData } from '../components/DeviceNode';
import Sidebar from '../components/Sidebar';
import Inspector, { type Selection } from '../components/Inspector';
import NewDeviceModal from '../components/NewDeviceModal';
import NewCableModal from '../components/NewCableModal';
import SettingsModal from '../components/SettingsModal';

const nodeTypes = { device: DeviceNode };

/** Deterministic per-edge jitter for the smoothstep "offset" (how far a path overshoots its
 *  source/target before turning). Two cables that happen to run the same rectilinear route — e.g.
 *  several mics all heading to the same stage box — would otherwise trace the exact same corner
 *  points and read as one line; staggering the overshoot fans their elbows out just enough to
 *  keep each cable visually distinct. */
function edgeOffset(id: string, min = 14, max = 58): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return min + (hash % (max - min));
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

  const initialNodes: Node[] = useMemo(
    () =>
      (graph?.devices ?? [])
        // A device with a parent nests inside that parent's card instead of getting its own node
        // — unless it has real ports of its own (e.g. a power brick strapped to a pedalboard),
        // in which case its cables still need somewhere to land.
        .filter((device) => !device.parentDeviceId || device.ports.length > 0)
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
    const map = new Map<string, string>();
    for (const d of graph?.devices ?? []) for (const p of d.ports) map.set(p.id, d.id);
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
        // Right-angle routing hugs node edges instead of cutting diagonally across the canvas —
        // with devices already grid-aligned by the zone layout, that keeps parallel runs visually
        // distinct instead of bundling into an X of crossing bezier curves.
        type: 'smoothstep',
        pathOptions: { borderRadius: 10, offset: edgeOffset(cable.id) },
        style: {
          stroke: CABLE_COLORS[cable.cableType],
          strokeWidth: selection?.kind === 'cable' && selection.id === cable.id ? 3 : 1.5,
          strokeDasharray: cable.cableType === CableType.CONTROL_LINK ? '6 4' : undefined,
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

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      movePosition.mutate({ id: node.id, position: { x: node.position.x, y: node.position.y } });
    },
    [movePosition],
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
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_320px]">
        <Sidebar
          devices={graph.devices}
          selectedId={selection?.kind === 'device' ? selection.id : null}
          onSelect={(id) => setSelection({ kind: 'device', id })}
          onNewDevice={() => {
            setNewDeviceParentId(null);
            setShowNewDevice(true);
          }}
        />
        {view === 'canvas' && (
          <div className="relative min-h-0">
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
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
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        )}
        {view === 'input-list' && <InputListTable setupId={setupId} />}
        {view === 'rider' && <RiderTable setupId={setupId} />}
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
