import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Chip } from '@heroui/react';
import { InventoryStatus, PortDirection } from '@resopatch/shared';
import type { GraphDevice } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';

export interface DeviceNodeData {
  device: GraphDevice;
  [key: string]: unknown;
}

const STATUS_LABEL: Record<string, string> = {
  [InventoryStatus.OWNED_ACTIVE]: 'в сетапе',
  [InventoryStatus.OWNED_INACTIVE]: 'не активно',
  [InventoryStatus.PLANNED_NOT_OWNED]: 'план',
  [InventoryStatus.VENUE_PROVIDED]: 'площадка',
};

const STATUS_COLOR: Record<string, 'success' | 'default' | 'warning' | 'accent'> = {
  [InventoryStatus.OWNED_ACTIVE]: 'success',
  [InventoryStatus.OWNED_INACTIVE]: 'default',
  [InventoryStatus.PLANNED_NOT_OWNED]: 'warning',
  [InventoryStatus.VENUE_PROVIDED]: 'accent',
};

function DeviceNodeImpl({ data, selected }: NodeProps) {
  const { device } = data as unknown as DeviceNodeData;
  const ports = device.ports;
  const inactive = device.inventoryStatus !== InventoryStatus.OWNED_ACTIVE && device.inventoryStatus !== InventoryStatus.VENUE_PROVIDED;

  return (
    <div
      className={`w-[220px] rounded-lg border bg-surface-secondary text-xs shadow-lg ${
        selected ? 'border-accent ring-2 ring-accent/40' : 'border-default-200'
      } ${inactive ? 'border-dashed opacity-70' : ''}`}
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <DeviceTypeIcon type={device.type} className="h-3.5 w-3.5 shrink-0 text-default-500" />
        <span className="truncate font-semibold text-foreground" title={device.type}>
          {device.name}
        </span>
      </div>
      <div className="flex items-center gap-1 px-2.5 pb-1.5 pt-1">
        <Chip size="sm" color={STATUS_COLOR[device.inventoryStatus]} variant="soft">
          {STATUS_LABEL[device.inventoryStatus]}
        </Chip>
      </div>
      {device.ownerRole && <div className="px-2.5 pb-1.5 text-[10px] text-default-500">{device.ownerRole}</div>}
      {ports.length > 0 && (
        <div className="border-t border-default-200">
          {ports.map((port) => {
            const showLeft = port.direction === PortDirection.IN || port.direction === PortDirection.BI;
            const showRight = port.direction === PortDirection.OUT || port.direction === PortDirection.BI;
            return (
              <div key={port.id} className="relative border-b border-white/5 px-3.5 py-1 last:border-b-0">
                {showLeft && <Handle type="target" position={Position.Left} id={port.id} />}
                <span className="block truncate pr-1 text-[10.5px] text-default-500" title={`${port.name} (${port.portType})`}>
                  {port.name}
                </span>
                {showRight && <Handle type="source" position={Position.Right} id={port.id} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default memo(DeviceNodeImpl);
