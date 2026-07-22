import { useMemo } from 'react';
import { Button, Modal } from '@heroui/react';
import { Layers, Plus, X } from 'lucide-react';
import type { Connection } from '@xyflow/react';
import type { GraphCable, GraphDevice } from '../api/client';
import { containerInternalGraph } from '../lib/containerGraph';
import PatchCanvas from './PatchCanvas';
import { CABLE_COLORS, CABLE_DASH, CABLE_WIDTH_SCALE, CableType, DeviceType, InventoryStatus } from '@resopatch/shared';
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
}: ContainerInsideModalProps) {
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

  // Find external cables connected to children inside this container
  const { boundaryNodes, boundaryCables } = useMemo(() => {
    const bNodes: GraphDevice[] = [];
    const bCables: GraphCable[] = [];
    const createdBoundaryDevices = new Map<string, GraphDevice>();

    for (const cable of allCables) {
      const sourceDev = allPortToDevice.get(cable.sourcePortId);
      const targetDev = allPortToDevice.get(cable.targetPortId);
      if (!sourceDev || !targetDev) continue;

      const sourceInChild = childIds.has(sourceDev.id);
      const targetInChild = childIds.has(targetDev.id);

      // Boundary cable: one end in container, one end outside (or container itself)
      if (sourceInChild !== targetInChild) {
        const extDev = sourceInChild ? targetDev : sourceDev;
        const extPort = sourceInChild ? allPortById.get(cable.targetPortId) : allPortById.get(cable.sourcePortId);
        if (!extDev || !extPort) continue;

        let virtualDev = createdBoundaryDevices.get(extDev.id);
        if (!virtualDev) {
          const newVirtualDev = {
            id: `virtual-ext-${extDev.id}`,
            setupId: containerDevice.setupId,
            name: `Внешний: ${extDev.name}`,
            type: extDev.type,
            notes: `Внешнее устройство: ${extDev.name}`,
            inventoryStatus: InventoryStatus.OWNED_ACTIVE,
            ownerRole: extDev.ownerRole,
            parentDeviceId: null,
            position: { x: sourceInChild ? 1200 : -320, y: bNodes.length * 140 },
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

  const displayedDevices = useMemo(() => [...childDevices, ...boundaryNodes], [childDevices, boundaryNodes]);
  const displayedCables = useMemo(() => [...internalCables, ...boundaryCables], [internalCables, boundaryCables]);

  const portToNodeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of displayedDevices) {
      for (const p of d.ports) map.set(p.id, d.id);
    }
    return map;
  }, [displayedDevices]);

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
            onSelectChild,
            onOpenInside: () => {},
          } satisfies DeviceNodeData,
        };
      }),
    [displayedDevices, childrenByParent, onSelectChild],
  );

  const edges: Edge[] = useMemo(
    () =>
      displayedCables.map((cable) => ({
        id: cable.id,
        source: portToNodeId.get(cable.sourcePortId) ?? '',
        sourceHandle: cable.sourcePortId,
        target: portToNodeId.get(cable.targetPortId) ?? '',
        targetHandle: cable.targetPortId,
        label: cable.color ?? undefined,
        type: 'routed',
        style: {
          stroke: CABLE_COLORS[cable.cableType],
          strokeWidth: (CABLE_WIDTH_SCALE[cable.cableType] ?? 1) * 1.5,
          strokeDasharray: CABLE_DASH[cable.cableType],
        },
        animated: cable.cableType === CableType.CONTROL_LINK,
      })),
    [displayedCables, portToNodeId],
  );

  return (
    <Modal>
      <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
        <Modal.Container className="w-[98vw] h-[94vh] max-w-none">
          <Modal.Dialog className="flex h-full w-full flex-col p-0 overflow-hidden bg-surface border border-default-200 shadow-2xl">
            <Modal.CloseTrigger />
            <div className="flex items-center justify-between border-b border-default-200 px-5 py-3 bg-surface">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <Layers className="h-4 w-4" />
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
            <div className="relative min-h-0 flex-1 p-0 overflow-hidden bg-background">
              {childDevices.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-default-500">
                  <p>В этом педалборде пока нет устройств.</p>
                  <Button size="sm" onPress={() => onAddChild(containerDevice.id)}>
                    <Plus className="h-4 w-4" />
                    Добавить устройство
                  </Button>
                </div>
              ) : (
                <PatchCanvas
                  nodes={nodes}
                  edges={edges}
                  onNodeClick={onSelectChild}
                  onEdgeClick={() => {}}
                  onPaneClick={() => {}}
                  onConnect={onConnect}
                  onNodeMoved={onNodeMoved}
                  minimap={false}
                  fitPadding={0.08}
                />
              )}
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
