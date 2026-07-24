import { Button, Modal } from '@heroui/react';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import type { Edge, Node } from '@xyflow/react';
import { Layers, Wand2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GraphCable, GraphDevice } from '../api/client';
import { containerInternalGraph } from '../lib/containerGraph';
import { getDisplayName } from '../lib/deviceNaming';
import { graphCableToEdge } from '../lib/graphCableToEdge';
import { useI18n } from '../lib/i18n';
import { pickNearestSourceHandle, pickNearestTargetHandle } from '../lib/portHandles';
import type { DeviceNodeData } from './DeviceNode';
import Inspector, { type Selection } from './Inspector';
import PatchCanvas from './PatchCanvas';

export interface ContainerInsideModalProps {
  containerDevice: GraphDevice;
  allDevices: GraphDevice[];
  allCables: GraphCable[];
  onClose: () => void;
  onSelectChild: (id: string) => void;
  onNodeMoved: (id: string, position: { x: number; y: number }) => void;
  onRunAutoLayout: () => void;
  isAutoLayoutPending: boolean;
}

/** Orders devices inside a container topologically by signal cable connections (source -> target),
 *  so pedals render left-to-right, top-to-bottom in the exact order they are patched. */
function sortDevicesBySignalFlow(devices: GraphDevice[], cables: GraphCable[]): GraphDevice[] {
  if (devices.length <= 1) return devices;

  const deviceMap = new Map(devices.map((d) => [d.id, d]));
  const portToDevice = new Map<string, string>();
  for (const d of devices) {
    for (const p of d.ports) {
      portToDevice.set(p.id, d.id);
    }
  }

  const nextMap = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const d of devices) {
    nextMap.set(d.id, new Set());
    inDegree.set(d.id, 0);
  }

  for (const c of cables) {
    const srcDevId = portToDevice.get(c.sourcePortId);
    const tgtDevId = portToDevice.get(c.targetPortId);
    if (srcDevId && tgtDevId && srcDevId !== tgtDevId) {
      if (!nextMap.get(srcDevId)!.has(tgtDevId)) {
        nextMap.get(srcDevId)!.add(tgtDevId);
        inDegree.set(tgtDevId, (inDegree.get(tgtDevId) ?? 0) + 1);
      }
    }
  }

  const sorted: GraphDevice[] = [];
  const visited = new Set<string>();

  // Entry nodes (inDegree === 0)
  const queue: string[] = devices.filter((d) => (inDegree.get(d.id) ?? 0) === 0).map((d) => d.id);

  while (queue.length > 0) {
    const currId = queue.shift()!;
    if (visited.has(currId)) continue;
    visited.add(currId);
    const dev = deviceMap.get(currId);
    if (dev) sorted.push(dev);

    const targets = Array.from(nextMap.get(currId) ?? []);
    for (const tgtId of targets) {
      const deg = (inDegree.get(tgtId) ?? 1) - 1;
      inDegree.set(tgtId, deg);
      if (deg <= 0 && !visited.has(tgtId)) {
        queue.push(tgtId);
      }
    }
  }

  // Append any remaining unvisited devices (disconnected or cyclic)
  for (const d of devices) {
    if (!visited.has(d.id)) {
      sorted.push(d);
    }
  }

  return sorted;
}

export default function ContainerInsideModal({
  containerDevice,
  allDevices,
  allCables,
  onClose,
  onSelectChild,
  onNodeMoved,
  onRunAutoLayout,
  isAutoLayoutPending,
}: ContainerInsideModalProps) {
  const { t, language } = useI18n();
  const [modalSelection, setModalSelection] = useState<Selection>(null);
  const { nodes: childDevices, cables: internalCables } = useMemo(
    () => containerInternalGraph(allDevices, allCables, containerDevice.id),
    [allDevices, allCables, containerDevice.id],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<string, GraphDevice[]>();
    for (const d of allDevices) {
      if (!d.parentDeviceId) continue;
      const list = map.get(d.parentDeviceId) ?? [];
      list.push(d);
      map.set(d.parentDeviceId, list);
    }
    return map;
  }, [allDevices]);

  const childIds = useMemo(() => new Set(childDevices.map((d) => d.id)), [childDevices]);

  const allPortToDevice = useMemo(() => {
    const map = new Map<string, GraphDevice>();
    for (const d of allDevices) {
      for (const p of d.ports) map.set(p.id, d);
    }
    return map;
  }, [allDevices]);

  const allPortById = useMemo(() => {
    const map = new Map<string, GraphDevice['ports'][number]>();
    for (const d of allDevices) {
      for (const p of d.ports) map.set(p.id, p);
    }
    return map;
  }, [allDevices]);

  // Compute clean, non-overlapping grid positions for pedals inside the container ordered by signal flow
  const positionedChildDevices = useMemo(() => {
    const power = childDevices.filter((d) => d.type === DeviceType.POWER_SUPPLY || d.type === DeviceType.POWER_SPLITTER || d.type === DeviceType.POWER_STRIP);
    const unsortedSignal = childDevices.filter((d) => d.type !== DeviceType.POWER_SUPPLY && d.type !== DeviceType.POWER_SPLITTER && d.type !== DeviceType.POWER_STRIP);

    const signal = sortDevicesBySignalFlow(unsortedSignal, internalCables);

    const COLS = 4;
    const GAP_X = 360; // 240px card + 120px gap
    const ROW_HEIGHT = 440; // ~250px card (including possible image banner) + 190px gap

    const result: GraphDevice[] = [];

    signal.forEach((d, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      result.push({
        ...d,
        position: { x: col * GAP_X, y: row * ROW_HEIGHT },
      });
    });

    const signalRows = Math.ceil(signal.length / COLS);
    const powerStartY = Math.max(1, signalRows) * ROW_HEIGHT;
    power.forEach((d, i) => {
      result.push({
        ...d,
        position: { x: i * GAP_X, y: powerStartY },
      });
    });

    return result;
  }, [childDevices, internalCables]);

  // Find external cables connected to children inside this container
  const { boundaryNodes, boundaryCables } = useMemo(() => {
    const bNodes: GraphDevice[] = [];
    const bCables: GraphCable[] = [];
    const createdBoundaryDevices = new Map<string, GraphDevice>();

    let leftCount = 0;
    let rightCount = 0;

    for (const cable of allCables) {
      const sourceDev = allPortToDevice.get(cable.sourcePortId);
      const targetDev = allPortToDevice.get(cable.targetPortId);
      if (!sourceDev || !targetDev) continue;

      const sourceInChild = childIds.has(sourceDev.id);
      const targetInChild = childIds.has(targetDev.id);

      if (sourceInChild !== targetInChild) {
        const extDev = sourceInChild ? targetDev : sourceDev;
        const extPort = sourceInChild ? allPortById.get(cable.targetPortId) : allPortById.get(cable.sourcePortId);
        if (!extDev || !extPort) continue;

        // Clone port so we never mutate the live graph's port list (shared refs).
        const portClone = { ...extPort };
        const virtualDev = createdBoundaryDevices.get(extDev.id);
        if (!virtualDev) {
          // External device that *feeds into* the board sits on the left (cable enters pedals).
          // External that *receives* from the board sits on the right.
          const isLeft = !sourceInChild;
          const posX = isLeft ? -380 : 1380;
          const posY = (isLeft ? leftCount++ : rightCount++) * 260;

          const newVirtualDev = {
            id: `virtual-ext-${extDev.id}`,
            setupId: containerDevice.setupId,
            name: `${t('containerModal.externalPrefix')} ${getDisplayName(extDev, t, language)}`,
            type: extDev.type,
            notes: `${t('containerModal.externalDeviceNote')} ${getDisplayName(extDev, t, language)}`,
            inventoryStatus: InventoryStatus.OWNED_ACTIVE,
            ownerRole: extDev.ownerRole,
            parentDeviceId: null,
            position: { x: posX, y: posY },
            ports: [portClone],
            powerRequired: false,
            powerSourceType: 'NONE',
            hostUsbType: 'NONE',
            imageUrl: extDev.imageUrl,
            furniture: null,
            attrs: {},
          } as GraphDevice;
          createdBoundaryDevices.set(extDev.id, newVirtualDev);
          bNodes.push(newVirtualDev);
        } else {
          if (!virtualDev.ports.some((p) => p.id === portClone.id)) {
            virtualDev.ports = [...virtualDev.ports, portClone];
          }
        }
        bCables.push(cable);
      }
    }
    return { boundaryNodes: bNodes, boundaryCables: bCables };
  }, [allCables, allPortToDevice, allPortById, childIds, containerDevice.setupId, t, language]);

  const displayedDevices = useMemo(() => [...positionedChildDevices, ...boundaryNodes], [positionedChildDevices, boundaryNodes]);
  const displayedCables = useMemo(() => [...internalCables, ...boundaryCables], [internalCables, boundaryCables]);

  const portToNodeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of displayedDevices) {
      for (const p of d.ports) map.set(p.id, d.id);
    }
    return map;
  }, [displayedDevices]);

  const connectedPortIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCables) {
      set.add(c.sourcePortId);
      set.add(c.targetPortId);
    }
    return set;
  }, [allCables]);

  const nodes: Node[] = useMemo(
    () =>
      displayedDevices.map((device) => {
        const isVirtual = device.id.startsWith('virtual-ext-');
        return {
          id: device.id,
          type: 'device',
          position: device.position,
          data: {
            device,
            children: isVirtual ? [] : childrenByParent.get(device.id) ?? [],
            boundaryPorts: [],
            connectedPortIds,
            onSelectChild,
            onOpenInside: () => {},
          } satisfies DeviceNodeData,
        };
      }),
    [displayedDevices, childrenByParent, connectedPortIds, onSelectChild],
  );

  const edges: Edge[] = useMemo(() => {
    const raw = displayedCables.map((cable) =>
      graphCableToEdge(cable, allPortById, allPortToDevice, portToNodeId),
    );
    // Pre-pick L/R faces from the fixed grid so WASM starts on the facing nipples
    // (before RF has measured port rows).
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return raw.map((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t || !e.sourceHandle || !e.targetHandle) return e;
      // Approximate card size until measured — pedal cards are ~240 wide.
      const sw = 240;
      const tw = 240;
      const sCx = s.position.x + sw / 2;
      const tCx = t.position.x + tw / 2;
      const src = pickNearestSourceHandle(e.sourceHandle, sCx, tCx);
      const tgt = pickNearestTargetHandle(e.targetHandle, sCx, tCx);
      return { ...e, sourceHandle: src.id, targetHandle: tgt.id };
    });
  }, [displayedCables, portToNodeId, allPortById, allPortToDevice, nodes]);

  return (
    <Modal>
      <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
        <Modal.Container className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] mx-auto overflow-hidden !w-[98vw] !max-w-[98vw]">
          <Modal.Dialog className="flex h-full w-full flex-col p-0 overflow-hidden bg-surface border border-default-200 shadow-2xl rounded-xl !w-full !max-w-none">
            <Modal.CloseTrigger />
            <div className="flex items-center justify-between border-b border-default-200 px-5 py-3 bg-surface">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 min-w-10 min-h-10 shrink-0 aspect-square items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <Layers className="h-5 w-5 shrink-0 aspect-square" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">{getDisplayName(containerDevice, t, language)} — {t('containerModal.title')}</h2>
                  <p className="text-xs text-default-500">
                    {t('containerModal.subtitle').replace('{devices}', String(childDevices.length)).replace('{ports}', String(boundaryNodes.length))}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onPress={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
              <div className="relative min-h-0 flex-1 p-0 overflow-hidden">
                {childDevices.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-default-500">
                    <p>{t('containerModal.empty')}</p>
                  </div>
                ) : (
                  <>
                    <PatchCanvas
                      key={`inside-${containerDevice.id}`}
                      nodes={nodes}
                      edges={edges}
                      layoutSyncKey={displayedDevices.length * 1000 + displayedCables.length}
                      onNodeClick={(id) => {
                        // Virtual external stubs are not selectable inventory.
                        if (id.startsWith('virtual-ext-')) return;
                        setModalSelection({ kind: 'device', id });
                        onSelectChild(id);
                      }}
                      onEdgeClick={(id) => setModalSelection({ kind: 'cable', id })}
                      onPaneClick={() => setModalSelection(null)}
                      onConnect={() => {}}
                      onNodeMoved={(id, position) => {
                        if (id.startsWith('virtual-ext-')) return;
                        onNodeMoved(id, position);
                      }}
                      minimap={false}
                      fitPadding={0.06}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={onRunAutoLayout}
                      isPending={isAutoLayoutPending}
                      className="absolute bottom-3 right-3 z-10 shadow-lg"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {t('canvas.arrange')}
                    </Button>
                  </>
                )}
              </div>
              <div className="w-[320px] h-full flex-none overflow-hidden border-l border-default-200 bg-surface">
                <Inspector
                  graph={{ devices: allDevices, cables: allCables, adapters: [] }}
                  selection={modalSelection ?? { kind: 'device', id: containerDevice.id }}
                  setupId={containerDevice.setupId}
                  onSelectDevice={(id) => {
                    setModalSelection({ kind: 'device', id });
                    onSelectChild(id);
                  }}
                />
              </div>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
