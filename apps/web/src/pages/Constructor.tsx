import { useCallback, useMemo, useRef, useState } from "react";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner, Table, Tabs } from "@heroui/react";
import {
  Cable as CableIcon,
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
import { formatI18nText } from "../lib/i18nText";
import { formatOwnerRole } from "../lib/ownerRole";
import SettingsModal from "../components/SettingsModal";
import ContainerInsideModal from "../components/ContainerInsideModal";
import StaffChecklist from "../components/StaffChecklist";
import CableListView from "../components/CableListView";
import { splitMainCanvasGraph } from "../lib/containerGraph";
import { useI18n } from "../lib/i18n";

export default function Constructor({
  setupId,
  setupName,
}: {
  setupId: string;
  setupName: string;
}) {
  const { t, language } = useI18n();
  const qc = useQueryClient();
  const graphQuery = useQuery({
    queryKey: ["graph", setupId],
    queryFn: () => api.getGraph(setupId),
    // Keep retrying indefinitely on connectivity failures during initial load, instead of
    // surfacing a raw "Failed to fetch" — see graphQuery.isLoading/!graph branch below.
    retry: true,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
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
  const [view, setView] = useState<"canvas" | "input-list" | "rider" | "checklist" | "cables">("canvas");
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

  // Selecting anything opens the inspector panel — folded into the same setter (rather than a
  // separate effect reacting to `selection`) so it's one state update, not two render passes.
  const selectItem = useCallback((sel: Selection) => {
    setSelection(sel);
    if (sel) setInspectorOpen(true);
  }, []);

  const onSelectChild = useCallback((id: string) => selectItem({ kind: "device", id }), [selectItem]);

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

  if (!graph || !activeGraph)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
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
            {t('header.setupMode.noKeys')}
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
            {t('header.setupMode.withKeys')}
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
              <Tabs.List aria-label={t('header.tab.canvas')}>
                <Tabs.Tab id="canvas" aria-label={t('header.tab.canvas')}>
                  <span title={t('header.tab.canvas')}><LayoutGrid className="h-3.5 w-3.5" /></span>
                </Tabs.Tab>
                <Tabs.Tab id="input-list" aria-label={t('header.tab.inputList')}>
                  <Tabs.Separator />
                  <span title={t('header.tab.inputList')}><ListMusic className="h-3.5 w-3.5" /></span>
                </Tabs.Tab>
                <Tabs.Tab id="rider" aria-label={t('header.tab.rider')}>
                  <Tabs.Separator />
                  <span title={t('header.tab.rider')}><ClipboardList className="h-3.5 w-3.5" /></span>
                </Tabs.Tab>
                <Tabs.Tab id="checklist" aria-label={t('header.tab.checklist')}>
                  <Tabs.Separator />
                  <span title={t('header.tab.checklist')}><CheckSquare className="h-3.5 w-3.5" /></span>
                </Tabs.Tab>
                <Tabs.Tab id="cables" aria-label={t('header.tab.cables')}>
                  <Tabs.Separator />
                  <span title={t('header.tab.cables')}><CableIcon className="h-3.5 w-3.5" /></span>
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          <span title={t('header.settings')}>
            <Button size="sm" variant="ghost" onPress={() => setShowSettings(true)}>
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </span>
          <span title={t('header.logout')}>
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
      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-20 bg-black/40 sm:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div
          className={`min-h-0 flex-none overflow-hidden transition-[width] duration-150 ${
            sidebarOpen
              ? "absolute inset-y-0 left-0 z-30 w-[85vw] max-w-[280px] shadow-2xl sm:static sm:z-auto sm:w-[260px] sm:max-w-none sm:shadow-none"
              : "w-0"
          }`}
        >
          <Sidebar
            devices={graph.devices}
            cables={graph.cables}
            selectedId={selection?.id ?? null}
            onSelect={(id) => selectItem({ kind: "device", id })}
            onSelectCable={(id) => selectItem({ kind: "cable", id })}
            onNewDevice={() => {
              setNewDeviceParentId(null);
              setShowNewDevice(true);
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? t('constructor.hideInventory') : t('constructor.showInventory')}
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
              onNodeClick={(id) => selectItem({ kind: "device", id })}
              onEdgeClick={(id) => selectItem({ kind: "cable", id })}
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
          {view === "canvas" && (
            <Button
              size="sm"
              variant="secondary"
              onPress={runAutoLayout}
              isPending={autoLayout.isPending}
              className="absolute bottom-3 right-3 z-10 shadow-lg"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {t('canvas.arrange')}
            </Button>
          )}
          {view === "input-list" && (
            <InputListTable setupId={setupId} devices={activeGraph.devices} hasKeys={setupMode === "with-keys"} />
          )}
          {view === "rider" && (
            <RiderTable setupId={setupId} devices={activeGraph.devices} hasKeys={setupMode === "with-keys"} />
          )}
          {view === "checklist" && (
            <StaffChecklist devices={activeGraph.devices} cables={activeGraph.cables} setupId={setupId} />
          )}
          {view === "cables" && <CableListView devices={graph.devices} cables={graph.cables} />}
        </div>

        <button
          type="button"
          onClick={() => setInspectorOpen((v) => !v)}
          title={inspectorOpen ? t('constructor.hideInspector') : t('constructor.showInspector')}
          className="flex w-5 flex-none items-center justify-center border-l border-default-200 bg-surface text-default-500 hover:bg-surface-secondary hover:text-foreground"
        >
          {inspectorOpen ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
        {inspectorOpen && (
          <div
            className="absolute inset-0 z-20 bg-black/40 sm:hidden"
            onClick={() => setInspectorOpen(false)}
          />
        )}
        <div
          className={`min-h-0 flex-none overflow-hidden transition-[width] duration-150 ${
            inspectorOpen
              ? "absolute inset-y-0 right-0 z-30 w-[85vw] max-w-[320px] shadow-2xl sm:static sm:z-auto sm:w-[320px] sm:max-w-none sm:shadow-none"
              : "w-0"
          }`}
        >
          <Inspector
            graph={graph}
            selection={selection}
            setupId={setupId}
            onAddChild={(parentId) => {
              setNewDeviceParentId(parentId);
              setShowNewDevice(true);
            }}
            onSelectDevice={(id) => selectItem({ kind: "device", id })}
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
          onSelectChild={(id) => selectItem({ kind: "device", id })}
          onAddChild={(containerId) => {
            setNewDeviceParentId(containerId);
            setShowNewDevice(true);
          }}
          onConnect={onConnect}
          onNodeMoved={(id, position) => movePosition.mutate({ id, position })}
          onRunAutoLayout={runAutoLayout}
          isAutoLayoutPending={autoLayout.isPending}
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
            sourceDeviceName={formatI18nText(pendingSourceDevice.name, language)}
            targetDeviceName={formatI18nText(pendingTargetDevice.name, language)}
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

function InputListTable({ setupId, devices, hasKeys }: { setupId: string; devices?: GraphDevice[]; hasKeys: boolean }) {
  const { t, language } = useI18n();
  const query = useQuery({
    queryKey: ["input-list", setupId, hasKeys],
    queryFn: () => api.getInputList(setupId, hasKeys),
  });
  if (query.isLoading)
    return (
      <div className="h-full min-h-0 overflow-auto p-4 text-sm text-default-500">
        {t('constructor.loading')}
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="h-full min-h-0 overflow-auto p-4 text-sm text-default-500">
        {t('constructor.errorLoading')}
      </div>
    );

  const columns: { key: keyof InputListRow; label: string }[] = [
    { key: "channel", label: "CH" },
    { key: "sourceName", label: t('constructor.table.source') },
    { key: "connector", label: t('constructor.table.connector') },
    { key: "routing", label: t('constructor.table.routing') },
    { key: "zone", label: t('constructor.table.zone') },
    { key: "owner", label: t('constructor.table.owner') },
  ];

  return (
    <div className="h-full min-h-0 overflow-auto p-4">
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
                    <DevicePhotoCell name={formatI18nText(r.sourceName, language)} devices={devices} />
                  </Table.Cell>
                  <Table.Cell>{r.connector}</Table.Cell>
                  <Table.Cell>{r.routing}</Table.Cell>
                  <Table.Cell>{formatI18nText(r.zone, language)}</Table.Cell>
                  <Table.Cell>{formatOwnerRole(r.owner, t)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

function RiderTable({ setupId, devices, hasKeys }: { setupId: string; devices?: GraphDevice[]; hasKeys: boolean }) {
  const { t, language } = useI18n();
  const query = useQuery({
    queryKey: ["rider", setupId, hasKeys],
    queryFn: () => api.getRider(setupId, hasKeys),
  });
  if (query.isLoading)
    return (
      <div className="h-full min-h-0 overflow-auto p-4 text-sm text-default-500">
        {t('constructor.loading')}
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="h-full min-h-0 overflow-auto p-4 text-sm text-default-500">
        {t('constructor.errorLoading')}
      </div>
    );

  const venueRows = query.data.filter((r) => !r.isUserOwned);

  return (
    <div className="h-full min-h-0 overflow-auto p-4">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Rider">
            <Table.Header>
              <Table.Column>{t('constructor.table.category')}</Table.Column>
              <Table.Column>{t('constructor.table.equipmentName')}</Table.Column>
              <Table.Column>{t('constructor.table.quantity')}</Table.Column>
              <Table.Column>{t('constructor.table.note')}</Table.Column>
            </Table.Header>
            <Table.Body>
              {venueRows.map((r: RiderRow, i: number) => (
                <Table.Row key={i}>
                  <Table.Cell>{r.category}</Table.Cell>
                  <Table.Cell>
                    <DevicePhotoCell name={formatI18nText(r.name, language)} devices={devices} />
                  </Table.Cell>
                  <Table.Cell>{r.quantity}</Table.Cell>
                  <Table.Cell>{formatI18nText(r.note ?? "", language)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}
