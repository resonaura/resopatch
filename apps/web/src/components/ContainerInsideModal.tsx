import { useState, useMemo } from 'react';
import { Button, Modal } from '@heroui/react';
import { Layers, Plus, Wand2, X } from 'lucide-react';
import type { Connection } from '@xyflow/react';
import type { GraphCable, GraphDevice } from '../api/client';
import { containerInternalGraph } from '../lib/containerGraph';
import PatchCanvas from './PatchCanvas';
import Inspector, { type Selection } from './Inspector';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { graphCableToEdge } from '../lib/graphCableToEdge';
import type { Node, Edge } from '@xyflow/react';
import type { DeviceNodeData } from './DeviceNode';

export interface ContainerInsideModalProps {
  containerDevice: GraphDevice;
  allDevices: GraphDevice[];
  allCables: GraphCable[];
  onClose: () => void;
  onSelectChild: (id: string) => void;
  onAddChild: (containerId: string) => void;
  onConnect: (connection: Connection) => void;
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
  onAddChild,
  onConnect,
  onNodeMoved,
  onRunAutoLayout,
  isAutoLayoutPending,
}: ContainerInsideModalProps) {
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

        let virtualDev = createdBoundaryDevices.get(extDev.id);
        if (!virtualDev) {
          const isLeft = !sourceInChild; // If target is in child, connection enters from left
          const posX = isLeft ? -360 : 1340;
          const posY = (isLeft ? leftCount++ : rightCount++) * 240;

          const newVirtualDev = {
            id: `virtual-ext-${extDev.id}`,
            setupId: containerDevice.setupId,
            name: `Внешний: ${extDev.name}`,
            type: extDev.type,
            notes: `Внешнее устройство: ${extDev.name}`,
            inventoryStatus: InventoryStatus.OWNED_ACTIVE,
            ownerRole: extDev.ownerRole,
            parentDeviceId: null,
            position: { x: posX, y: posY },
            ports: [extPort],
            powerRequired: false,
            powerSourceType: 'NONE',
            hostUsbType: 'NONE',
            imageUrl: extDev.imageUrl,
            furniture: null,
          } as GraphDevice;
          createdBoundaryDevices.set(extDev.id, newVirtualDev);
          bNodes.push(newVirtualDev);
        } else {
          if (!virtualDev.ports.some((p) => p.id === extPort.id)) {
            virtualDev.ports.push(extPort);
          }
        }
        bCables.push(cable);
      }
    }
    return { boundaryNodes: bNodes, boundaryCables: bCables };
  }, [allCables, allPortToDevice, allPortById, childIds, containerDevice.setupId]);

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

  const edges: Edge[] = useMemo(
    () =>
      displayedCables.map((cable) =>
        graphCableToEdge(cable, allPortById, allPortToDevice, portToNodeId),
      ),
    [displayedCables, portToNodeId, allPortById, allPortToDevice],
  );

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
                  <h2 className="text-base font-semibold text-foreground">{containerDevice.name} — Внутренняя схема</h2>
                  <p className="text-xs text-default-500">
                    Компоненты борда ({childDevices.length} устройств), внешние подключения ({boundaryNodes.length} разьёмов) и внутреннее питание
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onPress={() => onAddChild(containerDevice.id)}>
                  <Plus className="h-4 w-4" />
                  Добавить педаль
                </Button>
                <Button size="sm" variant="secondary" onPress={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
              <div className="relative min-h-0 flex-1 p-0 overflow-hidden">
                {childDevices.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-default-500">
                    <p>В этом педалборде пока нет устройств.</p>
                    <Button size="sm" onPress={() => onAddChild(containerDevice.id)}>
                      <Plus className="h-4 w-4" />
                      Добавить устройство
                    </Button>
                  </div>
                ) : (
                  <>
                    <PatchCanvas
                      nodes={nodes}
                      edges={edges}
                      onNodeClick={(id) => {
                        setModalSelection({ kind: 'device', id });
                        onSelectChild(id);
                      }}
                      onEdgeClick={(id) => setModalSelection({ kind: 'cable', id })}
                      onPaneClick={() => setModalSelection(null)}
                      onConnect={onConnect}
                      onNodeMoved={onNodeMoved}
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
                      Упорядочить
                    </Button>
                  </>
                )}
              </div>
              <div className="w-[320px] h-full flex-none overflow-hidden border-l border-default-200 bg-surface">
                <Inspector
                  graph={{ devices: allDevices, cables: allCables, adapters: [] }}
                  selection={modalSelection ?? { kind: 'device', id: containerDevice.id }}
                  setupId={containerDevice.setupId}
                  onAddChild={onAddChild}
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
