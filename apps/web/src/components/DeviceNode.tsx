import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Chip } from '@heroui/react';
import { Layers } from 'lucide-react';
import { InventoryStatus, PortDirection } from '@resopatch/shared';
import type { GraphDevice } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import { ProgressiveImage } from '../lib/img';
import { portChannelColor } from '../lib/portChannel';
import { PortTypeIcon } from '../lib/portIcons';

/** `imageUrl` doubles as either a relative path into the api's optimized image storage
 *  (see apps/api/src/images) or a raw `data:`/pasted URL from ImagePicker's upload flow —
 *  only the former can be resolved through the auto-optimization pipeline (manifest lookup
 *  + breakpoint/format negotiation), so this tells the two apart. */
function isStorageImage(url: string): boolean {
  return !url.startsWith('data:') && !/^https?:\/\//i.test(url);
}

/** Full-width photo banner across the top of a device card. Renders above the header row
 *  instead of the small square thumb whenever a photo is set — the node grows taller to
 *  fit it (see DeviceThumb below for the fallback used in compact contexts like the nested
 *  accessory list, where a banner would be too tall). */
function DeviceImageBanner({ device }: { device: Pick<GraphDevice, 'imageUrl' | 'name'> }) {
  if (!device.imageUrl) return null;
  if (isStorageImage(device.imageUrl)) {
    return <ProgressiveImage src={device.imageUrl} alt={device.name} className="w-full" />;
  }
  return <img src={device.imageUrl} alt="" className="block w-full object-cover" />;
}

/** A descendant's port that needs a Handle proxied onto this (collapsed) container card because
 *  something outside the container plugs into it — see containerGraph.ts for how this set is
 *  computed. `deviceName` is shown as a subtitle so "Mono In" is still identifiable once it's no
 *  longer nested under its own pedal's mini-header. */
export interface BoundaryPort {
  port: GraphDevice['ports'][number];
  deviceName: string;
}

export interface DeviceNodeData {
  device: GraphDevice;
  /** Devices with parentDeviceId === this node's device. Ones with no ports of their own
   *  (accessories: straps, tuner, velcro, cases) render as a plain nested list. Ones *with* ports
   *  (e.g. a pedalboard's 11 pedals + PSU) are never rendered inline here at all — that's exactly
   *  what used to clutter this card and tangle cables on top of it. Instead the card collapses to
   *  its `boundaryPorts` plus a button that opens their own scoped canvas (ContainerInsideModal). */
  children: GraphDevice[];
  boundaryPorts: BoundaryPort[];
  onSelectChild: (id: string) => void;
  onOpenInside: (deviceId: string) => void;
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

function PortRow({ port, subtitle }: { port: GraphDevice['ports'][number]; subtitle?: string }) {
  const channelColor = portChannelColor(port.name);
  return (
    <div className="relative flex items-center gap-1.5 border-b border-white/5 px-3.5 py-1.5 last:border-b-0">
      <Handle type="target" position={Position.Left} id={port.id} />
      <Handle type="source" position={Position.Left} id={`${port.id}-src-left`} />
      {channelColor && <span className="h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-black/40" style={{ backgroundColor: channelColor }} />}
      <PortTypeIcon portType={port.portType} />
      <span className="block min-w-0 flex-1 truncate text-[10.5px] text-default-500" title={`${port.name}${subtitle ? ` · ${subtitle}` : ''} (${port.portType})`}>
        {port.name}
        {subtitle && <span className="block truncate text-[9px] text-default-500/70">{subtitle}</span>}
      </span>
      <Handle type="source" position={Position.Right} id={port.id} />
      <Handle type="target" position={Position.Right} id={`${port.id}-tgt-right`} />
    </div>
  );
}

/** Small square thumbnail used wherever a device needs to be told apart at a glance (node header,
 *  nested ported-child row, inventory list) — falls back to the type icon when no photo is set,
 *  so callers never need an `if (imageUrl)` branch of their own.
 *
 *  Storage images (relative paths into the API image store) are fetched through the
 *  /img/ optimisation endpoint at 64 px so the browser doesn't download a full-res
 *  photo just to render a 16 × 16 square. */
function DeviceThumb({ device, className }: { device: Pick<GraphDevice, 'imageUrl' | 'type'>; className: string }) {
  if (device.imageUrl) {
    const thumbSrc = isStorageImage(device.imageUrl)
      ? `/img/${device.imageUrl}?w=64`
      : device.imageUrl;
    return <img src={thumbSrc} alt="" className={`shrink-0 aspect-square rounded object-contain object-center ${className}`} />;
  }
  return <DeviceTypeIcon type={device.type} className={`shrink-0 aspect-square text-default-500 ${className}`} />;
}

function DeviceNodeImpl({ data, selected }: NodeProps) {
  const { device, children, boundaryPorts, onSelectChild, onOpenInside } = data as unknown as DeviceNodeData;
  const ports = device.ports;
  const isVirtual = device.id.startsWith('virtual-ext-');
  const inactive = device.inventoryStatus !== InventoryStatus.OWNED_ACTIVE && device.inventoryStatus !== InventoryStatus.VENUE_PROVIDED;
  const portedChildren = children.filter((c) => c.ports.length > 0);
  const plainChildren = children.filter((c) => c.ports.length === 0);
  const isContainer = portedChildren.length > 0;

  return (
    <div
      className={`w-[240px] overflow-hidden rounded-lg border text-xs shadow-lg transition-opacity ${
        selected
          ? 'border-accent ring-2 ring-accent/40 bg-surface-secondary'
          : isVirtual
          ? 'border-dashed border-default-300 bg-surface/40 opacity-60 hover:opacity-100'
          : 'border-default-200 bg-surface-secondary'
      } ${inactive && !isVirtual ? 'border-dashed opacity-70' : ''}`}
    >
      <DeviceImageBanner device={device} />
      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        {/* Hide the small thumb when there is already a full-width banner above */}
        {!device.imageUrl && <DeviceThumb device={device} className="h-4 w-4" />}
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
      {isContainer && (
        <>
          {boundaryPorts.length > 0 && (
            <div className="border-t border-default-200">
              {boundaryPorts.map((b) => (
                <PortRow key={b.port.id} port={b.port} subtitle={b.deviceName} />
              ))}
            </div>
          )}
          <div className="border-t border-default-200 p-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenInside(device.id);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent/10 px-2 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20"
            >
              <Layers className="h-3.5 w-3.5" />
              Показать внутри ({portedChildren.length})
            </button>
          </div>
        </>
      )}
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
                <DeviceThumb device={child} className="h-5 w-5" />
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
