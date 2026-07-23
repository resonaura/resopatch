import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Table, Tabs } from "@heroui/react";
import {
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
  CABLE_COLORS,
  CABLE_DASH,
  CABLE_WIDTH_SCALE,
  CableType,
  getPowerCableStyle,
  type InputListRow,
  type PortDto,
  type RiderRow,
} from "@resopatch/shared";
import { api, type GraphDevice } from "../api/client";
import type { DeviceNodeData } from "../components/DeviceNode";
import PatchCanvas from "../components/PatchCanvas";
import Sidebar from "../components/Sidebar";
import Inspector, { type Selection } from "../components/Inspector";
import NewDeviceModal from "../components/NewDeviceModal";
import NewCableModal from "../components/NewCableModal";
import SettingsModal from "../components/SettingsModal";
import ContainerInsideModal from "../components/ContainerInsideModal";
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
  const [view, setView] = useState<"canvas" | "input-list" | "rider">("canvas");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const [insideContainerId, setInsideContainerId] = useState<string | null>(
    null,
  );

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

  const mainGraph = useMemo(() => {
    if (!graph)
      return {
        externalCables: [],
        internalCableIds: new Set<string>(),
        boundaryPortsByContainer: new Map(),
      };
    return splitMainCanvasGraph(graph.devices, graph.cables);
  }, [graph]);

  const deviceByPortId = useMemo(() => {
    const map = new Map<string, GraphDevice>();
    for (const d of graph?.devices ?? []) {
      for (const p of d.ports) map.set(p.id, d);
    }
    return map;
  }, [graph]);

  const onSelectChild = useCallback(
    (id: string) => setSelection({ kind: "device", id }),
    [],
  );

  useEffect(() => {
    if (selection) setInspectorOpen(true);
  }, [selection]);

  const initialNodes: Node[] = useMemo(
    () =>
      (graph?.devices ?? [])
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
              onSelectChild,
              onOpenInside: (id: string) => setInsideContainerId(id),
            } satisfies DeviceNodeData,
            selected:
              selection?.kind === "device" && selection.id === device.id,
          };
        }),
    [
      graph,
      mainGraph,
      childrenByParent,
      deviceByPortId,
      onSelectChild,
      selection,
    ],
  );

  const portToDevice = useMemo(() => {
    const deviceById = new Map((graph?.devices ?? []).map((d) => [d.id, d]));
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
      mainGraph.externalCables.map((cable) => {
        const isSelected = selection?.kind === "cable" && selection.id === cable.id;
        const sPort = graph?.devices.flatMap((d) => d.ports).find((p) => p.id === cable.sourcePortId);
        const tPort = graph?.devices.flatMap((d) => d.ports).find((p) => p.id === cable.targetPortId);
        const sDev = deviceByPortId.get(cable.sourcePortId);
        const tDev = deviceByPortId.get(cable.targetPortId);

        const voltage = sPort?.power.voltageV ?? tPort?.power.voltageV ?? sDev?.power.voltageV ?? tDev?.power.voltageV;
        const currentType = sPort?.power.currentType ?? tPort?.power.currentType ?? sDev?.power.currentType ?? tDev?.power.currentType;

        let stroke = CABLE_COLORS[cable.cableType];
        let widthScale = CABLE_WIDTH_SCALE[cable.cableType];
        let dash = CABLE_DASH[cable.cableType];

        if (cable.cableType === CableType.POWER_LINE) {
          const portType = sPort?.portType ?? tPort?.portType;
          const devType = sDev?.type ?? tDev?.type;
          const powerStyle = getPowerCableStyle(voltage, currentType, portType, devType);
          stroke = powerStyle.stroke;
          widthScale = powerStyle.widthScale;
          dash = powerStyle.dash ?? dash;
        }

        const sIsMains = sPort?.portType === 'POWER_SCHUKO' || sPort?.portType === 'POWER_IEC' || sDev?.type === 'POWER_STRIP';
        const tIsMains = tPort?.portType === 'POWER_SCHUKO' || tPort?.portType === 'POWER_IEC' || tDev?.type === 'POWER_STRIP';
        const isPowerAdapter = cable.cableType === CableType.POWER_LINE && ((sIsMains && !tIsMains) || (tIsMains && !sIsMains));

        let powerConverter = null;
        if (isPowerAdapter) {
          const targetVoltage = tPort?.power.voltageV ?? sPort?.power.voltageV ?? tDev?.power.voltageV ?? sDev?.power.voltageV ?? 9;
          const targetCurrent = tPort?.power.currentType ?? sPort?.power.currentType ?? tDev?.power.currentType ?? sDev?.power.currentType ?? 'DC';
          const styleInfo = getPowerCableStyle(targetVoltage, targetCurrent, null, null);
          powerConverter = {
            fromVoltage: '120V AC',
            toVoltage: `${targetVoltage}V ${targetCurrent}`,
            adapterName: 'БП',
            dcColor: styleInfo.stroke,
          };
          if (styleInfo.dash) dash = styleInfo.dash;
        }

        return {
          id: cable.id,
          source: portToDevice.get(cable.sourcePortId) ?? "",
          sourceHandle: cable.sourcePortId,
          target: portToDevice.get(cable.targetPortId) ?? "",
          targetHandle: cable.targetPortId,
          label: cable.color ?? undefined,
          selected: isSelected,
          type: "routed",
          data: {
            powerConverter,
            texture:
              cable.textureStartUrl || cable.textureEndUrl || cable.textureMiddleUrl
                ? { start: cable.textureStartUrl, end: cable.textureEndUrl, middle: cable.textureMiddleUrl }
                : undefined,
          },
          style: {
            stroke,
            strokeWidth: (isSelected ? 3 : 1.5) * widthScale,
            strokeDasharray: dash,
          },
          animated: cable.cableType === CableType.CONTROL_LINK,
          zIndex: isSelected ? 1 : 0,
        };
      }),
    [mainGraph.externalCables, portToDevice, selection, graph, deviceByPortId],
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
  if (graphQuery.isError || !graph)
    return (
      <div className="flex h-full items-center justify-center text-default-500">
        Не удалось загрузить сетап.
      </div>
    );

  const pendingSourcePort = pendingConnection
    ? graph.devices
        .flatMap((d) => d.ports)
        .find((p) => p.id === pendingConnection.sourceHandle)
    : null;
  const pendingTargetPort = pendingConnection
    ? graph.devices
        .flatMap((d) => d.ports)
        .find((p) => p.id === pendingConnection.targetHandle)
    : null;
  const pendingSourceDevice = pendingConnection
    ? graph.devices.find((d) => d.id === pendingConnection.source)
    : null;
  const pendingTargetDevice = pendingConnection
    ? graph.devices.find((d) => d.id === pendingConnection.target)
    : null;

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
          {view === "input-list" && <InputListTable setupId={setupId} />}
          {view === "rider" && <RiderTable setupId={setupId} />}
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

function InputListTable({ setupId }: { setupId: string }) {
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
                  <Table.Cell>{r.isUserOwned ? "наше" : "площадка"}</Table.Cell>
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
