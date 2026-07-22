import { useMemo } from 'react';
import { Button, Modal } from '@heroui/react';
import { Layers, Plus, X } from 'lucide-react';
import type { Connection } from '@xyflow/react';
import type { GraphCable, GraphDevice } from '../api/client';
import { containerInternalGraph } from '../lib/containerGraph';
import PatchCanvas from './PatchCanvas';
import { CABLE_COLORS, CABLE_DASH, CABLE_WIDTH_SCALE, CableType } from '@resopatch/shared';
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

  const portToDevice = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of childDevices) {
      for (const p of d.ports) map.set(p.id, d.id);
    }
    return map;
  }, [childDevices]);

  const nodes: Node[] = useMemo(
    () =>
      childDevices.map((device) => ({
        id: device.id,
        type: 'device',
        position: device.position,
        data: {
          device,
          children: childrenByParent.get(device.id) ?? [],
          boundaryPorts: [],
          onSelectChild,
          onOpenInside: () => {},
        } satisfies DeviceNodeData,
      })),
    [childDevices, childrenByParent, onSelectChild],
  );

  const edges: Edge[] = useMemo(
    () =>
      internalCables.map((cable) => ({
        id: cable.id,
        source: portToDevice.get(cable.sourcePortId) ?? '',
        sourceHandle: cable.sourcePortId,
        target: portToDevice.get(cable.targetPortId) ?? '',
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
    [internalCables, portToDevice],
  );

  return (
    <Modal>
      <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
        <Modal.Container className="max-w-[92vw] h-[85vh] w-full">
          <Modal.Dialog className="flex h-full w-full flex-col p-0 overflow-hidden bg-surface border border-default-200 shadow-2xl">
            <Modal.CloseTrigger />
            <div className="flex items-center justify-between border-b border-default-200 px-5 py-3 bg-surface">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <Layers className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">{containerDevice.name} — Внутренняя схема</h2>
                  <p className="text-xs text-default-500">Компоненты борда, патч-кабели и внутреннее питание ({childDevices.length} устройств)</p>
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
                />
              )}
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
