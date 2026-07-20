import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { InventoryStatus, PortDirection } from '@resopatch/shared';
import type { GraphDevice } from '../api/client';

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

function DeviceNodeImpl({ data, selected }: NodeProps) {
  const { device } = data as unknown as DeviceNodeData;
  const ports = device.ports;

  return (
    <div className={`device-node status-${device.inventoryStatus} ${selected ? 'selected' : ''}`}>
      <div className="device-node-header">
        <span className="device-node-name">{device.name}</span>
        <span className="device-node-type">{device.type}</span>
      </div>
      <div className={`device-node-status-badge status-badge-${device.inventoryStatus}`}>{STATUS_LABEL[device.inventoryStatus]}</div>
      {device.ownerRole && <div className="device-node-owner">{device.ownerRole}</div>}
      {ports.length > 0 && (
        <div className="device-node-ports">
          {ports.map((port) => {
            const showLeft = port.direction === PortDirection.IN || port.direction === PortDirection.BI;
            const showRight = port.direction === PortDirection.OUT || port.direction === PortDirection.BI;
            return (
              <div key={port.id} className="device-node-port-row">
                {showLeft && <Handle type="target" position={Position.Left} id={port.id} />}
                <span className="port-label" title={port.portType}>
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
