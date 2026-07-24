import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Table, Tabs } from "@heroui/react";
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  LayoutGrid,
  ListMusic,
  LogOut,
  Settings,
  Wand2,
} from "lucide-react";
import {
  type InputListRow,
  type PortDto,
  type RiderRow,
} from "@resopatch/shared";
import { graphCableToEdge } from "../lib/graphCableToEdge";
import { api, type GraphDevice } from "../api/client";
import type { DeviceNodeData } from "../components/DeviceNode";
import PatchCanvas from "../components/PatchCanvas";
import Sidebar from "../components/Sidebar";
import Inspector, { type Selection } from "../components/Inspector";
import NewDeviceModal from "../components/NewDeviceModal";
import NewCableModal from "../components/NewCableModal";
import SettingsModal from "../components/SettingsModal";
import ContainerInsideModal from "../components/ContainerInsideModal";
import StaffChecklist from "../components/StaffChecklist";
import { splitMainCanvasGraph } from "../lib/containerGraph";

export default function Constructor({
  setupId,
  setupName,
}: {
  setupId: string;
  setupName: string;
}) {
  const qc = useQueryClient();
  const graphQuery = useQuery({
    queryKey: ["graph", setupId],
    queryFn: () => api.getGraph(setupId),
  });
  const graph = graphQuery.data;

  const [selection, setSelection] = useState<Selection>(null);
  const [showNewDevice, setShowNewDevice] = useState(false);
  const [newDeviceParentId, setNewDeviceParentId] = useState<string | null>(
    null,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(
    null,
  );
  const [view, setView] = useState<"canvas" | "input-list" | "rider" | "checklist">("canvas");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [insideContainerId, setInsideContainerId] = useState<string | null>(null);

  const [setupMode, setSetupMode] = useState<'no-keys' | 'with-keys'>(() => {
    try {
      return (localStorage.getItem(`resopatch_setup_mode_${setupId}`) as 'no-keys' | 'with-keys') || 'no-keys';
    } catch {
      return 'no-keys';
    }
  });

  const handleSetupModeChange = (mode: 'no-keys' | 'with-keys') => {
    setSetupMode(mode);
    try {
      localStorage.setItem(`resopatch_setup_mode_${setupId}`, mode);
    } catch {
      // ignore
    }
  };

  const activeDevices = useMemo(() => {
    if (!graph?.devices) return [];
    if (setupMode === 'with-keys') return graph.devices;
    return graph.devices.filter((d) => !d.attrs?.isKeysOnly);
  }, [graph, setupMode]);

  const activeCables = useMemo(() => {
    if (!graph?.cables) return [];
    if (setupMode === 'with-keys') return graph.cables;

    const activePortIds = new Set(activeDevices.flatMap((d) => d.ports).map((p) => p.id));
    return graph.cables.filter(
      (c) => activePortIds.has(c.sourcePortId) && activePortIds.has(c.targetPortId),
    );
  }, [graph, activeDevices, setupMode]);

  const activeGraph = useMemo(() => {
    if (!graph) return null;
    return {
      ...graph,
      devices: activeDevices,
      cables: activeCables,
    };
  }, [graph, activeDevices, activeCables]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, GraphDevice[]>();
    for (const d of activeGraph?.devices ?? []) {
      if (!d.parentDeviceId) continue;
      const list = map.get(d.parentDeviceId) ?? [];
      list.push(d);
      map.set(d.parentDeviceId, list);
    }
    return map;
  }, [activeGraph]);

  const mainGraph = useMemo(() => {
    if (!activeGraph)
      return {
        externalCables: [],
        internalCableIds: new Set<string>(),
        boundaryPortsByContainer: new Map(),
      };
    return splitMainCanvasGraph(activeGraph.devices, activeGraph.cables);
  }, [activeGraph]);

  const deviceByPortId = useMemo(() => {
    const map = new Map<string, GraphDevice>();
    for (const d of activeGraph?.devices ?? []) {
      for (const p of d.ports) map.set(p.id, d);
    }
    return map;
  }, [activeGraph]);

  const onSelectChild = useCallback(
    (id: string) => setSelection({ kind: "device", id }),
    [],
  );

  useEffect(() => {
    if (selection) setInspectorOpen(true);
  }, [selection]);

  const connectedPortIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of activeGraph?.cables ?? []) {
      set.add(c.sourcePortId);
      set.add(c.targetPortId);
    }
    return set;
  }, [activeGraph]);

  const initialNodes: Node[] = useMemo(
    () =>
      (activeGraph?.devices ?? [])
        .filter((device) => !device.parentDeviceId)
        .map((device) => {
          const boundaryPortDtos =
            mainGraph.boundaryPortsByContainer.get(device.id) ?? [];
          const boundaryPorts = boundaryPortDtos.map((port: PortDto) => ({
            port,
            deviceName: deviceByPortId.get(port.id)?.name ?? "",
          }));
          return {
            id: device.id,
            type: "device",
            position: device.position,
            data: {
              device,
              children: childrenByParent.get(device.id) ?? [],
              boundaryPorts,
              connectedPortIds,
              onSelectChild,
              onOpenInside: (id: string) => setInsideContainerId(id),
            } satisfies DeviceNodeData,
            selected:
              selection?.kind === "device" && selection.id === device.id,
          };
        }),
    [
      activeGraph,
      mainGraph,
      childrenByParent,
      deviceByPortId,
      connectedPortIds,
      onSelectChild,
      selection,
    ],
  );

  const portToDevice = useMemo(() => {
    const deviceById = new Map((activeGraph?.devices ?? []).map((d) => [d.id, d]));
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
    for (const d of activeGraph?.devices ?? []) {
      const nodeId = topAncestorId(d);
      for (const p of d.ports) map.set(p.id, nodeId);
    }
    return map;
  }, [activeGraph]);

  const portById = useMemo(() => {
    const map = new Map<string, GraphDevice['ports'][number]>();
    for (const d of activeGraph?.devices ?? []) {
      for (const p of d.ports) map.set(p.id, p);
    }
    return map;
  }, [activeGraph]);

  const initialEdges: Edge[] = useMemo(
    () =>
      mainGraph.externalCables.map((cable) => {
        const isSelected = selection?.kind === "cable" && selection.id === cable.id;
        return graphCableToEdge(cable, portById, deviceByPortId, portToDevice, { selected: isSelected });
      }),
    [mainGraph.externalCables, portToDevice, portById, deviceByPortId, selection],
  );

  const movePosition = useMutation({
    mutationFn: (vars: { id: string; position: { x: number; y: number } }) =>
      api.updateDevice(vars.id, { position: vars.position }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", setupId] }),
  });

  const autoLayout = useMutation({
    mutationFn: (sizes: Record<string, { width: number; height: number }>) =>
      api.autoLayout(setupId, sizes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", setupId] }),
  });

  const getMeasuredSizesRef = useRef<
    (() => Record<string, { width: number; height: number }>) | null
  >(null);

  const runAutoLayout = useCallback(() => {
    const sizes = getMeasuredSizesRef.current
      ? getMeasuredSizesRef.current()
      : {};
    autoLayout.mutate(sizes);
  }, [autoLayout]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return;
    setPendingConnection(connection);
  }, []);

  if (graphQuery.isLoading)
    return (
      <div className="flex h-full items-center justify-center text-default-500">
        Загрузка сетапа…
      </div>
    );
  if (graphQuery.isError || !graph || !activeGraph)
    return (
      <div className="flex h-full items-center justify-center text-default-500">
        Не удалось загрузить сетап.
      </div>
    );

  const pendingSourcePort = pendingConnection
    ? activeGraph.devices
        .flatMap((d) => d.ports)
        .find((p) => p.id === pendingConnection.sourceHandle)
    : null;
  const pendingTargetPort = pendingConnection
    ? activeGraph.devices
        .flatMap((d) => d.ports)
        .find((p) => p.id === pendingConnection.targetHandle)
    : null;
  const pendingSourceDevice = pendingConnection
    ? activeGraph.devices.find((d) => d.id === pendingConnection.source)
    : null;
  const pendingTargetDevice = pendingConnection
    ? activeGraph.devices.find((d) => d.id === pendingConnection.target)
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-default-200 bg-surface px-4 py-2 select-none">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold tracking-tight text-foreground text-base">Resopatch</span>
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">PRO</span>
          </div>
          <div className="h-4 w-px bg-default-200" />
          <span className="text-xs font-medium text-default-500 max-w-[200px] truncate">{setupName}</span>
        </div>

        {/* Setup Mode Switcher */}
        <div className="flex items-center rounded-lg border border-default-200 bg-surface-secondary/80 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => handleSetupModeChange('no-keys')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
              setupMode === 'no-keys'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-default-500 hover:text-foreground'
            }`}
          >
            Без клавиш
          </button>
          <button
            type="button"
            onClick={() => handleSetupModeChange('with-keys')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
              setupMode === 'with-keys'
                ? 'bg-accent text-accent-foreground shadow-sm'
                : 'text-default-500 hover:text-foreground'
            }`}
          >
            С клавишами
          </button>
        </div>

        {/* Navigation & Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <Tabs
            selectedKey={view}
            onSelectionChange={(key) => setView(key as typeof view)}
            variant="secondary"
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
                <Tabs.Tab id="checklist">
                  <Tabs.Separator />
                  <CheckSquare className="h-3.5 w-3.5" />
                  Чеклист стаффа
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          {view === "canvas" && (
            <Button
              size="sm"
              variant="secondary"
              onPress={runAutoLayout}
              isPending={autoLayout.isPending}
            >
              <Wand2 className="h-3.5 w-3.5" />
              Упорядочить
            </Button>
          )}
          <span title="Настройки">
            <Button size="sm" variant="ghost" onPress={() => setShowSettings(true)}>
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </span>
          <span title="Выйти">
            <Button
              size="sm"
              variant="secondary"
              onPress={async () => {
                await api.logout();
                location.reload();
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div
          className={`min-h-0 flex-none overflow-hidden transition-[width] duration-150 ${sidebarOpen ? "w-[260px]" : "w-0"}`}
        >
          <Sidebar
            devices={graph.devices}
            selectedId={selection?.kind === "device" ? selection.id : null}
            onSelect={(id) => setSelection({ kind: "device", id })}
            onNewDevice={() => {
              setNewDeviceParentId(null);
              setShowNewDevice(true);
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Скрыть инвентарь" : "Показать инвентарь"}
          className="flex w-5 flex-none items-center justify-center border-r border-default-200 bg-surface text-default-500 hover:bg-surface-secondary hover:text-foreground"
        >
          {sidebarOpen ? (
            <ChevronLeft className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="relative min-h-0 flex-1">
          {view === "canvas" && (
            <PatchCanvas
              nodes={initialNodes}
              edges={initialEdges}
              onNodeClick={(id) => setSelection({ kind: "device", id })}
              onEdgeClick={(id) => setSelection({ kind: "cable", id })}
              onPaneClick={() => setSelection(null)}
              onConnect={onConnect}
              onNodeMoved={(id, position) =>
                movePosition.mutate({ id, position })
              }
              onGetMeasuredSizes={(getter) => {
                getMeasuredSizesRef.current = getter;
              }}
            />
          )}
          {view === "input-list" && <InputListTable setupId={setupId} devices={graph.devices} />}
          {view === "rider" && <RiderTable setupId={setupId} devices={graph.devices} />}
          {view === "checklist" && <StaffChecklist devices={graph.devices} cables={graph.cables} setupId={setupId} />}
        </div>

        <button
          type="button"
          onClick={() => setInspectorOpen((v) => !v)}
          title={inspectorOpen ? "Скрыть инспектор" : "Показать инспектор"}
          className="flex w-5 flex-none items-center justify-center border-l border-default-200 bg-surface text-default-500 hover:bg-surface-secondary hover:text-foreground"
        >
          {inspectorOpen ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
        <div
          className={`min-h-0 flex-none overflow-hidden transition-[width] duration-150 ${inspectorOpen ? "w-[320px]" : "w-0"}`}
        >
          <Inspector
            graph={graph}
            selection={selection}
            setupId={setupId}
            onAddChild={(parentId) => {
              setNewDeviceParentId(parentId);
              setShowNewDevice(true);
            }}
            onSelectDevice={(id) => setSelection({ kind: "device", id })}
          />
        </div>
      </div>
      {showNewDevice && (
        <NewDeviceModal
          setupId={setupId}
          defaultParentId={newDeviceParentId}
          onClose={() => setShowNewDevice(false)}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {insideContainerId && graph && (
        <ContainerInsideModal
          containerDevice={
            graph.devices.find((d) => d.id === insideContainerId)!
          }
          allDevices={graph.devices}
          allCables={graph.cables}
          onClose={() => setInsideContainerId(null)}
          onSelectChild={(id) => setSelection({ kind: "device", id })}
          onAddChild={(containerId) => {
            setNewDeviceParentId(containerId);
            setShowNewDevice(true);
          }}
          onConnect={onConnect}
          onNodeMoved={(id, position) => movePosition.mutate({ id, position })}
        />
      )}
      {pendingConnection &&
        pendingSourcePort &&
        pendingTargetPort &&
        pendingSourceDevice &&
        pendingTargetDevice && (
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

function DevicePhotoCell({ name, devices }: { name: string; devices?: GraphDevice[] }) {
  const match = devices?.find((d) => d.name === name || name.includes(d.name) || d.name.includes(name));
  if (match?.imageUrl) {
    const isStorage = !match.imageUrl.startsWith('data:') && !/^https?:\/\//i.test(match.imageUrl);
    const src = isStorage ? `/img/${match.imageUrl}?w=128` : match.imageUrl;
    return (
      <div className="flex items-center gap-2">
        <img src={src} alt="" className="h-8 w-8 shrink-0 rounded object-contain bg-black/20 p-0.5 border border-default-200" />
        <span className="font-medium">{name}</span>
      </div>
    );
  }
  return <span className="font-medium">{name}</span>;
}

function InputListTable({ setupId, devices }: { setupId: string; devices?: GraphDevice[] }) {
  const query = useQuery({
    queryKey: ["input-list", setupId],
    queryFn: () => api.getInputList(setupId),
  });
  if (query.isLoading)
    return (
      <div className="overflow-auto p-4 text-sm text-default-500">
        Загрузка…
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="overflow-auto p-4 text-sm text-default-500">
        Ошибка загрузки.
      </div>
    );

  const columns: { key: keyof InputListRow; label: string }[] = [
    { key: "channel", label: "CH" },
    { key: "sourceName", label: "Источник" },
    { key: "connector", label: "Разъём" },
    { key: "routing", label: "Маршрут" },
    { key: "zone", label: "Зона" },
    { key: "owner", label: "Владелец" },
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
                  <Table.Cell>{r.channel}</Table.Cell>
                  <Table.Cell>
                    <DevicePhotoCell name={r.sourceName} devices={devices} />
                  </Table.Cell>
                  <Table.Cell>{r.connector}</Table.Cell>
                  <Table.Cell>{r.routing}</Table.Cell>
                  <Table.Cell>{r.zone}</Table.Cell>
                  <Table.Cell>{r.owner}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

function RiderTable({ setupId, devices }: { setupId: string; devices?: GraphDevice[] }) {
  const query = useQuery({
    queryKey: ["rider", setupId],
    queryFn: () => api.getRider(setupId),
  });
  if (query.isLoading)
    return (
      <div className="overflow-auto p-4 text-sm text-default-500">
        Загрузка…
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="overflow-auto p-4 text-sm text-default-500">
        Ошибка загрузки.
      </div>
    );

  const venueRows = query.data.filter((r) => !r.isUserOwned);

  return (
    <div className="min-h-0 overflow-auto p-4">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Rider">
            <Table.Header>
              <Table.Column>Категория</Table.Column>
              <Table.Column>Наименование оборудования площадки</Table.Column>
              <Table.Column>Кол-во</Table.Column>
              <Table.Column>Заметка</Table.Column>
            </Table.Header>
            <Table.Body>
              {venueRows.map((r: RiderRow, i: number) => (
                <Table.Row key={i}>
                  <Table.Cell>{r.category}</Table.Cell>
                  <Table.Cell>
                    <DevicePhotoCell name={r.name} devices={devices} />
                  </Table.Cell>
                  <Table.Cell>{r.quantity}</Table.Cell>
                  <Table.Cell>{r.note ?? ""}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}
