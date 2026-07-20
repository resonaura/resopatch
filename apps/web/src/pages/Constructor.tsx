import { useCallback, useMemo, useState } from 'react';
import {
  Background,
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
import { CABLE_COLORS, CableType } from '@resopatch/shared';
import { api } from '../api/client';
import DeviceNode, { type DeviceNodeData } from '../components/DeviceNode';
import Sidebar from '../components/Sidebar';
import Inspector, { type Selection } from '../components/Inspector';
import NewDeviceModal from '../components/NewDeviceModal';
import NewCableModal from '../components/NewCableModal';

const nodeTypes = { device: DeviceNode };

export default function Constructor({ setupId, setupName }: { setupId: string; setupName: string }) {
  const qc = useQueryClient();
  const graphQuery = useQuery({ queryKey: ['graph', setupId], queryFn: () => api.getGraph(setupId) });
  const graph = graphQuery.data;

  const [selection, setSelection] = useState<Selection>(null);
  const [showNewDevice, setShowNewDevice] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [view, setView] = useState<'canvas' | 'input-list' | 'rider'>('canvas');

  const initialNodes: Node[] = useMemo(
    () =>
      (graph?.devices ?? []).map((device) => ({
        id: device.id,
        type: 'device',
        position: device.position,
        data: { device } satisfies DeviceNodeData,
        selected: selection?.kind === 'device' && selection.id === device.id,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, selection],
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
        style: {
          stroke: CABLE_COLORS[cable.cableType],
          strokeWidth: selection?.kind === 'cable' && selection.id === cable.id ? 3 : 1.5,
          strokeDasharray: cable.cableType === CableType.CONTROL_LINK ? '6 4' : undefined,
        },
        animated: cable.cableType === CableType.CONTROL_LINK,
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

  if (graphQuery.isLoading) return <div className="center-screen">Загрузка сетапа…</div>;
  if (graphQuery.isError || !graph) return <div className="center-screen">Не удалось загрузить сетап.</div>;

  const pendingSourcePort = pendingConnection ? graph.devices.flatMap((d) => d.ports).find((p) => p.id === pendingConnection.sourceHandle) : null;
  const pendingTargetPort = pendingConnection ? graph.devices.flatMap((d) => d.ports).find((p) => p.id === pendingConnection.targetHandle) : null;
  const pendingSourceDevice = pendingConnection ? graph.devices.find((d) => d.id === pendingConnection.source) : null;
  const pendingTargetDevice = pendingConnection ? graph.devices.find((d) => d.id === pendingConnection.target) : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Resopatch</h1>
        <span className="muted">{setupName}</span>
        <nav className="view-tabs">
          <button className={view === 'canvas' ? 'active' : ''} onClick={() => setView('canvas')}>
            Схема
          </button>
          <button className={view === 'input-list' ? 'active' : ''} onClick={() => setView('input-list')}>
            Input List
          </button>
          <button className={view === 'rider' ? 'active' : ''} onClick={() => setView('rider')}>
            Райдер
          </button>
        </nav>
        <button
          className="btn-secondary"
          onClick={async () => {
            await api.logout();
            location.reload();
          }}
        >
          Выйти
        </button>
      </header>
      <div className="app-body">
        <Sidebar devices={graph.devices} selectedId={selection?.kind === 'device' ? selection.id : null} onSelect={(id) => setSelection({ kind: 'device', id })} onNewDevice={() => setShowNewDevice(true)} />
        {view === 'canvas' && (
          <div className="canvas-wrap">
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
                colorMode="dark"
              >
                <Background gap={24} />
                <Controls />
                <MiniMap pannable zoomable />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        )}
        {view === 'input-list' && <ListView kind="input-list" setupId={setupId} />}
        {view === 'rider' && <ListView kind="rider" setupId={setupId} />}
        <Inspector graph={graph} selection={selection} setupId={setupId} />
      </div>
      {showNewDevice && <NewDeviceModal setupId={setupId} onClose={() => setShowNewDevice(false)} />}
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

function ListView({ kind, setupId }: { kind: 'input-list' | 'rider'; setupId: string }) {
  return kind === 'input-list' ? <InputListTable setupId={setupId} /> : <RiderTable setupId={setupId} />;
}

function InputListTable({ setupId }: { setupId: string }) {
  const query = useQuery({ queryKey: ['input-list', setupId], queryFn: () => api.getInputList(setupId) });
  if (query.isLoading) return <div className="list-view">Загрузка…</div>;
  if (query.isError || !query.data) return <div className="list-view">Ошибка загрузки.</div>;

  return (
    <div className="list-view">
      <table>
        <thead>
          <tr>
            <th>CH</th>
            <th>Источник</th>
            <th>Разъём</th>
            <th>Маршрут</th>
            <th>Зона</th>
            <th>Владелец</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((r) => (
            <tr key={r.channel}>
              <td>{r.channel}</td>
              <td>{r.sourceName}</td>
              <td>{r.connector}</td>
              <td>{r.routing}</td>
              <td>{r.zone}</td>
              <td>{r.owner}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiderTable({ setupId }: { setupId: string }) {
  const query = useQuery({ queryKey: ['rider', setupId], queryFn: () => api.getRider(setupId) });
  if (query.isLoading) return <div className="list-view">Загрузка…</div>;
  if (query.isError || !query.data) return <div className="list-view">Ошибка загрузки.</div>;

  return (
    <div className="list-view">
      <table>
        <thead>
          <tr>
            <th>Категория</th>
            <th>Наименование</th>
            <th>Кол-во</th>
            <th>Чьё</th>
            <th>Заметка</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((r, i) => (
            <tr key={i}>
              <td>{r.category}</td>
              <td>{r.name}</td>
              <td>{r.quantity}</td>
              <td>{r.isUserOwned ? 'наше' : 'площадка'}</td>
              <td>{r.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
