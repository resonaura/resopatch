import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Chip } from '@heroui/react';
import { InventoryStatus, PortDirection } from '@resopatch/shared';
import type { GraphDevice } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import { portChannelColor } from '../lib/portChannel';
import { PortTypeIcon } from '../lib/portIcons';

export interface DeviceNodeData {
  device: GraphDevice;
  /** Devices with parentDeviceId === this node's device — accessories (straps, tuner, velcro,
   *  cases) travel as a plain nested list with no ports of their own worth drawing cables to.
   *  A child that *does* have its own ports (e.g. a power brick strapped to a pedalboard) still
   *  nests visually the same way, but renders its ports as their own row with a real Handle —
   *  see `PortedChild` below — so it never becomes a second floating node on the canvas. */
  children: GraphDevice[];
  onSelectChild: (id: string) => void;
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

function PortRow({ port }: { port: GraphDevice['ports'][number] }) {
  const showLeft = port.direction === PortDirection.IN || port.direction === PortDirection.BI;
  const showRight = port.direction === PortDirection.OUT || port.direction === PortDirection.BI;
  const channelColor = portChannelColor(port.name);
  return (
    <div className="relative flex items-center gap-1.5 border-b border-white/5 px-3.5 py-1 last:border-b-0">
      {showLeft && <Handle type="target" position={Position.Left} id={port.id} />}
      {showLeft && <PortTypeIcon portType={port.portType} />}
      {channelColor && <span className="h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-black/40" style={{ backgroundColor: channelColor }} />}
      <span className="block min-w-0 flex-1 truncate pr-1 text-[10.5px] text-default-500" title={`${port.name} (${port.portType})`}>
        {port.name}
      </span>
      {showRight && <PortTypeIcon portType={port.portType} />}
      {showRight && <Handle type="source" position={Position.Right} id={port.id} />}
    </div>
  );
}

/** Small square thumbnail used wherever a device needs to be told apart at a glance (node header,
 *  nested ported-child row, inventory list) — falls back to the type icon when no photo is set,
 *  so callers never need an `if (imageUrl)` branch of their own. */
function DeviceThumb({ device, className }: { device: Pick<GraphDevice, 'imageUrl' | 'type'>; className: string }) {
  if (device.imageUrl) {
    return <img src={device.imageUrl} alt="" className={`shrink-0 rounded object-cover ${className}`} />;
  }
  return <DeviceTypeIcon type={device.type} className={`shrink-0 text-default-500 ${className}`} />;
}

/** A nested device that has real ports (e.g. PowerPlant ISO-12 Pro strapped to the pedalboard):
 *  its own mini header plus its own port rows, still inside the parent card — physically it
 *  travels as one unit with the parent, so visually it never gets a second box on the canvas. */
function PortedChild({ child, onSelectChild }: { child: GraphDevice; onSelectChild: (id: string) => void }) {
  return (
    <div className="border-t border-default-200">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelectChild(child.id);
        }}
        className="flex w-full items-center gap-1.5 bg-black/10 px-2.5 py-1 text-left hover:bg-white/10"
        title={child.notes ?? child.name}
      >
        <DeviceThumb device={child} className="h-3 w-3" />
        <span className="truncate text-[10.5px] font-medium text-default-400">{child.name}</span>
      </button>
      {child.ports.map((port) => (
        <PortRow key={port.id} port={port} />
      ))}
    </div>
  );
}

function DeviceNodeImpl({ data, selected }: NodeProps) {
  const { device, children, onSelectChild } = data as unknown as DeviceNodeData;
  const ports = device.ports;
  const inactive = device.inventoryStatus !== InventoryStatus.OWNED_ACTIVE && device.inventoryStatus !== InventoryStatus.VENUE_PROVIDED;
  const portedChildren = children.filter((c) => c.ports.length > 0);
  const plainChildren = children.filter((c) => c.ports.length === 0);

  return (
    <div
      className={`w-[220px] rounded-lg border bg-surface-secondary text-xs shadow-lg ${
        selected ? 'border-accent ring-2 ring-accent/40' : 'border-default-200'
      } ${inactive ? 'border-dashed opacity-70' : ''}`}
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <DeviceThumb device={device} className="h-4 w-4" />
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
          {ports.map((port) => (
            <PortRow key={port.id} port={port} />
          ))}
        </div>
      )}
      {portedChildren.map((child) => (
        <PortedChild key={child.id} child={child} onSelectChild={onSelectChild} />
      ))}
      {plainChildren.length > 0 && (
        <div className="border-t border-default-200 bg-black/10 px-2 py-1.5">
          <div className="mb-1 text-[9px] font-medium uppercase tracking-wide text-default-500">Комплект / аксессуары</div>
          <div className="flex flex-col gap-0.5">
            {plainChildren.map((child) => (
              <button
                key={child.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectChild(child.id);
                }}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white/5"
                title={child.notes ?? child.name}
              >
                <DeviceThumb device={child} className="h-3 w-3" />
                <span className="truncate text-[10.5px] text-default-500">{child.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DeviceNodeImpl);
