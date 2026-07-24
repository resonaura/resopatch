import { Button, Spinner, Table, Tabs } from "@heroui/react";
import { type PortDto, type RiderRow } from "@resopatch/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type GraphCable, type GraphDevice } from "../api/client";
import CableCanvasFilters, {
    cablePassesFilters,
    zoneOfCable,
    type CableCategory,
} from "../components/CableCanvasFilters";
import ContainerInsideModal from "../components/ContainerInsideModal";
import type { DeviceNodeData } from "../components/DeviceNode";
import Inspector, { type Selection } from "../components/Inspector";
import NewCableModal from "../components/NewCableModal";
import NewDeviceModal from "../components/NewDeviceModal";
import PatchCanvas from "../components/PatchCanvas";
import SettingsModal from "../components/SettingsModal";
import Sidebar from "../components/Sidebar";
import StaffChecklist from "../components/StaffChecklist";
import {
    computeAutoLayout,
    graphTopologyKey,
    LAYOUT_REVISION,
    positionsToRecord,
} from "../lib/autoLayout";
import { splitMainCanvasGraph } from "../lib/containerGraph";
import { portTypeLabel } from "../lib/enumLabels";
import { graphCableToEdge } from "../lib/graphCableToEdge";
import { useI18n } from "../lib/i18n";
import type { TranslationKey } from "../lib/i18n/dictionaries";
import { formatI18nText } from "../lib/i18nText";
import { formatOwnerRole } from "../lib/ownerRole";

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
  const [view, setView] = useState<"canvas" | "input-list" | "rider" | "checklist">("canvas");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [insideContainerId, setInsideContainerId] = useState<string | null>(null);

  // Cable visibility filters (live on canvas — replaces the old Cables page).
  const [cableCategory, setCableCategory] = useState<CableCategory>("all");
  const [hiddenConnectors, setHiddenConnectors] = useState<Set<string>>(() => new Set());
  const [hiddenCableZones, setHiddenCableZones] = useState<Set<string>>(() => new Set());

  const [setupMode, setSetupMode] = useState<'no-keys' | 'with-keys'>(() => {
    try {
      return (localStorage.getItem(`resopatch_setup_mode_${setupId}`) as 'no-keys' | 'with-keys') || 'no-keys';
    } catch {
      return 'no-keys';
    }
  });

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

  /** Devices/cables visible for a given setup mode (Arrange must match the canvas). */
  const graphSliceForMode = useCallback(
    (mode: 'no-keys' | 'with-keys') => {
      if (!graph) {
        return { devices: [] as GraphDevice[], cables: [] as GraphCable[] };
      }
      if (mode === 'with-keys') {
        return { devices: graph.devices, cables: graph.cables };
      }
      const devices = graph.devices.filter((d) => !d.attrs?.isKeysOnly);
      const portIds = new Set(devices.flatMap((d) => d.ports).map((p) => p.id));
      const cables = graph.cables.filter(
        (c) => portIds.has(c.sourcePortId) && portIds.has(c.targetPortId),
      );
      return { devices, cables };
    },
    [graph],
  );

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
          const boundaryPorts = boundaryPortDtos.map((port: PortDto) => {
            const owner = deviceByPortId.get(port.id);
            return {
              port,
              deviceName: owner ? formatI18nText(owner.name, language) : "",
            };
          });
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
      language,
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

  const initialEdges: Edge[] = useMemo(() => {
    const noZone = t("cables.noZone");
    const filters = {
      category: cableCategory,
      hiddenConnectors,
      hiddenZones: hiddenCableZones,
    };
    return mainGraph.externalCables
      .filter((cable) =>
        cablePassesFilters(cable, zoneOfCable(cable, deviceByPortId, noZone), filters, portById),
      )
      .map((cable) => {
        const isSelected = selection?.kind === "cable" && selection.id === cable.id;
        return graphCableToEdge(cable, portById, deviceByPortId, portToDevice, {
          selected: isSelected,
        });
      });
  }, [
    mainGraph.externalCables,
    portToDevice,
    portById,
    deviceByPortId,
    selection,
    cableCategory,
    hiddenConnectors,
    hiddenCableZones,
    t,
  ]);

  /**
   * Epoch bumped on every Arrange. In-flight drag saves that started before
   * Arrange must not overwrite the arranged positions (classic race:
   * drag-stop PUT lands after auto-layout PUT → canvas snaps back).
   */
  const arrangeEpochRef = useRef(0);
  const lastArrangePositionsRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  /** Bumps so PatchCanvas forces a position sync even if RF held local drag state. */
  const [layoutSyncKey, setLayoutSyncKey] = useState(0);

  const getMeasuredSizesRef = useRef<
    (() => Record<string, { width: number; height: number }>) | null
  >(null);

  const applyPositionsToCache = useCallback(
    (record: Record<string, { x: number; y: number }>) => {
      qc.setQueryData(["graph", setupId], (old: typeof graph) => {
        if (!old) return old;
        return {
          ...old,
          devices: old.devices.map((d) => {
            const pos = record[d.id];
            return pos ? { ...d, position: { x: pos.x, y: pos.y } } : d;
          }),
        };
      });
    },
    [qc, setupId],
  );

  const movePosition = useMutation({
    mutationFn: async (vars: { id: string; position: { x: number; y: number }; epoch: number }) => {
      // Drop the write if Arrange already started after this drag was queued.
      if (vars.epoch !== arrangeEpochRef.current) {
        return { ignored: true as const, id: vars.id };
      }
      await api.updateDevice(vars.id, { position: vars.position });
      // If Arrange finished while we were in flight, re-assert arranged coords.
      if (vars.epoch !== arrangeEpochRef.current) {
        const arranged = lastArrangePositionsRef.current?.[vars.id];
        if (arranged) {
          await api.updateDevice(vars.id, { position: arranged });
        }
        return { ignored: true as const, id: vars.id };
      }
      return { ignored: false as const, id: vars.id, position: vars.position };
    },
    onMutate: async (vars) => {
      // Optimistic local move; don't await a full graph refetch on every drag.
      if (vars.epoch !== arrangeEpochRef.current) return;
      applyPositionsToCache({ [vars.id]: vars.position });
    },
    onSuccess: (data) => {
      if (data.ignored) return;
      // Quiet background reconcile — skip if Arrange superseded us.
      void qc.invalidateQueries({ queryKey: ["graph", setupId] });
    },
  });

  /** Layout is computed entirely in the browser; the API only stores the result.
   *  Arrange always recomputes with default packing and overwrites manual drags.
   *  Pass `mode` to arrange the visible slice for that setup mode (no-keys / with-keys). */
  const autoLayout = useMutation({
    mutationFn: async (vars?: { mode?: 'no-keys' | 'with-keys' }) => {
      // Invalidate any in-flight drag saves even if graph is missing.
      arrangeEpochRef.current += 1;
      const epoch = arrangeEpochRef.current;
      const mode = vars?.mode ?? setupMode;

      if (!graph) {
        return {
          updated: 0,
          positions: {} as Record<string, { x: number; y: number }>,
          epoch,
        };
      }

      // Prefer live measured sizes; if canvas not ready, wait one frame and retry once.
      let sizes = getMeasuredSizesRef.current ? getMeasuredSizesRef.current() : {};
      if (Object.keys(sizes).length === 0) {
        await new Promise((r) => setTimeout(r, 50));
        sizes = getMeasuredSizesRef.current ? getMeasuredSizesRef.current() : {};
      }

      const { devices, cables } = graphSliceForMode(mode);
      if (devices.length === 0) {
        return { updated: 0, positions: {} as Record<string, { x: number; y: number }>, epoch };
      }

      const { positions } = computeAutoLayout(devices, cables, sizes);
      const record = positionsToRecord(positions);
      lastArrangePositionsRef.current = record;

      // Always paint defaults immediately (this is what "Arrange = reset" means).
      applyPositionsToCache(record);
      setLayoutSyncKey((k) => k + 1);

      const result = await api.autoLayout(setupId, record);
      // If a newer Arrange started, don't stamp older results.
      if (epoch !== arrangeEpochRef.current) {
        return { ...result, positions: lastArrangePositionsRef.current ?? record, epoch };
      }
      try {
        localStorage.setItem(
          `resopatch_layout_topo_${setupId}`,
          graphTopologyKey(devices, cables),
        );
        localStorage.setItem(`resopatch_layout_rev_${setupId}`, LAYOUT_REVISION);
      } catch {
        // ignore
      }
      return { ...result, positions: record, epoch };
    },
    onSuccess: async (data) => {
      if (data.epoch !== arrangeEpochRef.current) return;
      // Re-apply after refetch so a stale server response cannot undo Arrange.
      applyPositionsToCache(data.positions);
      setLayoutSyncKey((k) => k + 1);
      await qc.invalidateQueries({ queryKey: ["graph", setupId] });
      if (data.epoch !== arrangeEpochRef.current) return;
      applyPositionsToCache(data.positions);
      setLayoutSyncKey((k) => k + 1);
    },
  });

  const runAutoLayout = useCallback(() => {
    autoLayout.mutate({ mode: setupMode });
  }, [autoLayout, setupMode]);

  const handleSetupModeChange = useCallback(
    (mode: 'no-keys' | 'with-keys') => {
      if (mode === setupMode) return;
      setSetupMode(mode);
      try {
        localStorage.setItem(`resopatch_setup_mode_${setupId}`, mode);
      } catch {
        // ignore
      }
      // Re-pack for the new visible graph (keys in/out). Delay so RF can drop/add nodes first.
      window.setTimeout(() => {
        autoLayout.mutate({ mode });
      }, 100);
    },
    [setupMode, setupId, autoLayout],
  );

  // Auto re-layout when:
  //  - topology (devices/cables/ownership) changes, or
  //  - LAYOUT_REVISION bumps (default gap pack changed) so old saves pick up new defaults once.
  const layoutTopoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!graph) return;
    const key = graphTopologyKey(graph.devices, graph.cables);

    let stored: string | null = null;
    let storedRev: string | null = null;
    try {
      stored = localStorage.getItem(`resopatch_layout_topo_${setupId}`);
      storedRev = localStorage.getItem(`resopatch_layout_rev_${setupId}`);
    } catch {
      // ignore
    }

    const revisionStale = storedRev !== LAYOUT_REVISION;
    const topoStale = stored != null && stored !== key;
    const firstVisit = stored == null;

    if (firstVisit && !revisionStale) {
      // Brand-new setup: remember fingerprint, keep seed positions until user hits Arrange
      // (or until a later topology change). Still stamp revision so we don't thrash.
      try {
        localStorage.setItem(`resopatch_layout_topo_${setupId}`, key);
        localStorage.setItem(`resopatch_layout_rev_${setupId}`, LAYOUT_REVISION);
      } catch {
        // ignore
      }
      layoutTopoRef.current = key;
      return;
    }

    if (!revisionStale && !topoStale) {
      layoutTopoRef.current = key;
      return;
    }

    if (layoutTopoRef.current === key && !revisionStale) return;
    layoutTopoRef.current = key;

    // Wait for canvas measure, then apply default pack for the current setup mode.
    const t = window.setTimeout(() => {
      if (!autoLayout.isPending) autoLayout.mutate({ mode: setupMode });
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topology + revision only
  }, [graph, setupId]);

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
              layoutSyncKey={layoutSyncKey}
              onNodeClick={(id) => selectItem({ kind: "device", id })}
              onEdgeClick={(id) => selectItem({ kind: "cable", id })}
              onPaneClick={() => setSelection(null)}
              onConnect={onConnect}
              onNodeMoved={(id, position) => {
                if (autoLayout.isPending) return;
                movePosition.mutate({
                  id,
                  position,
                  epoch: arrangeEpochRef.current,
                });
              }}
              onGetMeasuredSizes={(getter) => {
                getMeasuredSizesRef.current = getter;
              }}
            />
          )}
          {view === "canvas" && (
            <>
              <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-6rem)]">
                <CableCanvasFilters
                  cables={activeGraph.cables}
                  devices={activeGraph.devices}
                  category={cableCategory}
                  hiddenConnectors={hiddenConnectors}
                  hiddenZones={hiddenCableZones}
                  onCategoryChange={setCableCategory}
                  onToggleConnector={(connector) =>
                    setHiddenConnectors((prev) => {
                      const next = new Set(prev);
                      if (next.has(connector)) next.delete(connector);
                      else next.add(connector);
                      return next;
                    })
                  }
                  onToggleZone={(zone) =>
                    setHiddenCableZones((prev) => {
                      const next = new Set(prev);
                      if (next.has(zone)) next.delete(zone);
                      else next.add(zone);
                      return next;
                    })
                  }
                />
              </div>
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
            </>
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
          onNodeMoved={(id, position) =>
            movePosition.mutate({ id, position, epoch: arrangeEpochRef.current })
          }
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

function DevicePhotoCell({
  name,
  matchName,
  devices,
}: {
  name: string;
  /** Optional cleaner name used only for device image lookup. */
  matchName?: string;
  devices?: GraphDevice[];
}) {
  const { language } = useI18n();
  const needle = matchName ?? name;
  const match = devices?.find((d) => {
    const dn = formatI18nText(d.name, language);
    return dn === needle || needle.includes(dn) || dn.includes(needle);
  });
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

  return (
    <div className="h-full min-h-0 overflow-auto p-4">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Input list">
            <Table.Header>
              <Table.Column>CH</Table.Column>
              <Table.Column>{t('constructor.table.source')}</Table.Column>
              <Table.Column>{t('constructor.table.connector')}</Table.Column>
              <Table.Column>{t('constructor.table.routing')}</Table.Column>
              <Table.Column>{t('constructor.table.zone')}</Table.Column>
              <Table.Column>{t('constructor.table.owner')}</Table.Column>
            </Table.Header>
            <Table.Body>
              {query.data.map((r) => {
                const deviceName = formatI18nText(r.sourceDeviceName, language);
                const portName = formatI18nText(r.sourcePortName, language);
                const sourceLabel = portName ? `${deviceName} — ${portName}` : deviceName;
                const routing = r.adapterName
                  ? t('constructor.routing.adapter').replace('{adapter}', formatI18nText(r.adapterName, language))
                  : t('constructor.routing.direct').replace('{source}', deviceName);
                return (
                  <Table.Row key={r.channel}>
                    <Table.Cell>{r.channel}</Table.Cell>
                    <Table.Cell>
                      <DevicePhotoCell name={sourceLabel} matchName={deviceName} devices={devices} />
                    </Table.Cell>
                    <Table.Cell>{portTypeLabel(r.connector, t)}</Table.Cell>
                    <Table.Cell>{routing}</Table.Cell>
                    <Table.Cell>{formatOwnerRole(r.zone, t)}</Table.Cell>
                    <Table.Cell>{formatOwnerRole(r.owner, t)}</Table.Cell>
                  </Table.Row>
                );
              })}
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
              {venueRows.map((r: RiderRow, i: number) => {
                const categoryKey = `constructor.category.${r.category}` as TranslationKey;
                return (
                  <Table.Row key={i}>
                    <Table.Cell>{t(categoryKey)}</Table.Cell>
                    <Table.Cell>
                      <DevicePhotoCell name={formatI18nText(r.name, language)} devices={devices} />
                    </Table.Cell>
                    <Table.Cell>{r.quantity}</Table.Cell>
                    <Table.Cell>{formatI18nText(r.note ?? "", language)}</Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}
