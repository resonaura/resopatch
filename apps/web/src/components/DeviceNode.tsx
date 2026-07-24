import { Chip } from '@heroui/react';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Layers } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { GraphDevice } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import { getDisplayName } from '../lib/deviceNaming';
import { useI18n } from '../lib/i18n';
import { formatI18nText } from '../lib/i18nText';
import { FALLBACK_ICON_CLASS } from '../lib/iconDefaults';
import { ProgressiveImage } from '../lib/img';
import { formatOwnerRole } from '../lib/ownerRole';
import { portChannelColor } from '../lib/portChannel';
import { PortTypeIcon } from '../lib/portIcons';

/** `imageUrl` doubles as either a relative path into the api's optimized image storage
 *  (see apps/api/src/images) or a raw `data:`/pasted URL from ImagePicker's upload flow —
 *  only the former can be resolved through the auto-optimization pipeline (manifest lookup
 *  + breakpoint/format negotiation), so this tells the two apart. */
function isStorageImage(url: string): boolean {
  return !url.startsWith('data:') && !/^https?:\/\//i.test(url);
}

/** Renders a single image inside the banner strip — storage paths go through the
 *  /img/ optimisation endpoint; data: and http(s) URLs are passed through as-is. */
function BannerImage({ url, alt, isOnly }: { url: string; alt: string; isOnly: boolean }) {
  const containerClass = `relative flex-1 h-full overflow-hidden ${isOnly ? 'rounded-none' : ''} bg-black/30 flex items-center justify-center p-1.5`;
  if (isStorageImage(url)) {
    return (
      <div className={containerClass}>
        <ProgressiveImage
          src={url}
          alt={alt}
          className="h-full w-full max-h-full max-w-full"
          objectFit="contain"
        />
      </div>
    );
  }
  return (
    <div className={containerClass}>
      <img src={url} alt="" className="max-h-full max-w-full object-contain m-auto" />
    </div>
  );
}

/** Full-width photo banner across the top of a device card. Fixed-height rectangle
 *  (max 140px). When `imageUrls` has multiple entries it renders an interactive slider
 *  allowing the user to slide left/right between all provided views. */
function DeviceImageBanner({ device }: { device: Pick<GraphDevice, 'imageUrl' | 'imageUrls' | 'name' | 'type'> }) {
  const { t, language } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(0);

  if (device.type === DeviceType.PEDALBOARD) return null;

  const urls: string[] = device.imageUrls?.length
    ? device.imageUrls
    : device.imageUrl
    ? [device.imageUrl]
    : [];

  if (urls.length === 0) return null;

  if (urls.length === 1) {
    return (
      <div className="flex w-full overflow-hidden border-b border-default-200/60 bg-black/20" style={{ height: '140px' }}>
        <BannerImage url={urls[0]} alt={formatI18nText(device.name, language)} isOnly={true} />
      </div>
    );
  }

  const prev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((i) => (i === 0 ? urls.length - 1 : i - 1));
  };

  const next = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((i) => (i === urls.length - 1 ? 0 : i + 1));
  };

  return (
    <div className="group relative w-full overflow-hidden border-b border-default-200/60 bg-black/20" style={{ height: '140px' }}>
      {/* Sliding Track */}
      <div
        className="flex h-full w-full transition-transform duration-300 ease-in-out"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {urls.map((url, i) => (
          <div key={url} className="h-full w-full shrink-0 flex-none">
            <BannerImage url={url} alt={`${formatI18nText(device.name, language)} view ${i + 1}`} isOnly={true} />
          </div>
        ))}
      </div>

      {/* Prev/Next arrows */}
      <button
        onClick={prev}
        className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white shadow transition-all hover:bg-black hover:scale-105 active:scale-95"
        title={t('deviceNode.prevView')}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={next}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white shadow transition-all hover:bg-black hover:scale-105 active:scale-95"
        title={t('deviceNode.nextView')}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>

      {/* Slide Dots */}
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/75 px-2 py-0.5 shadow">
        {urls.map((_, i) => (
          <span
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              setCurrentIndex(i);
            }}
            className={`h-1.5 cursor-pointer rounded-full transition-all ${i === currentIndex ? 'w-3.5 bg-accent' : 'w-1.5 bg-white/40 hover:bg-white'}`}
          />
        ))}
      </div>
    </div>
  );
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

const STATUS_COLOR: Record<string, 'success' | 'default' | 'warning' | 'accent'> = {
  [InventoryStatus.OWNED_ACTIVE]: 'success',
  [InventoryStatus.OWNED_INACTIVE]: 'default',
  [InventoryStatus.PLANNED_NOT_OWNED]: 'warning',
  [InventoryStatus.VENUE_PROVIDED]: 'accent',
};

function PortRow({
  port,
  subtitle,
  isConnected,
  isDimmed,
}: {
  port: GraphDevice['ports'][number];
  subtitle?: string;
  isConnected?: boolean;
  isDimmed?: boolean;
}) {
  const channelColor = portChannelColor(port.name);
  return (
    <div
      className={`relative flex items-center gap-1.5 border-b border-white/5 px-3.5 py-1.5 last:border-b-0 transition-opacity duration-200 ${
        isDimmed ? 'opacity-40 hover:opacity-90' : 'opacity-100 font-medium'
      }`}
    >
      <Handle type="target" position={Position.Left} id={port.id} />
      <Handle type="source" position={Position.Left} id={`${port.id}-src-left`} />
      {channelColor && <span className="h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-black/40" style={{ backgroundColor: channelColor }} />}
      <PortTypeIcon portType={port.portType} />
      <span className="block min-w-0 flex-1 truncate text-[10.5px] text-default-500" title={`${port.name}${subtitle ? ` · ${subtitle}` : ''} (${port.portType})`}>
        {port.name}
        {subtitle && <span className="block truncate text-[9px] text-default-500/70">{subtitle}</span>}
      </span>
      {isConnected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/80" />}
      <Handle type="source" position={Position.Right} id={port.id} />
      <Handle type="target" position={Position.Right} id={`${port.id}-tgt-right`} />
    </div>
  );
}

function PortsSection({
  ports,
  connectedPortIds,
}: {
  ports: GraphDevice['ports'];
  connectedPortIds: Set<string>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const unusedCount = useMemo(() => ports.filter((p) => !connectedPortIds.has(p.id)).length, [ports, connectedPortIds]);
  const shouldCollapse = ports.length > 4 && unusedCount > 0;

  // When collapsing, only show connected ports (or top 2 if none connected).
  // When expanded, render ALL ports in their exact array index order so their position is preserved!
  const visiblePorts = useMemo(() => {
    if (!shouldCollapse || expanded) return ports;
    const connected = ports.filter((p) => connectedPortIds.has(p.id));
    return connected.length > 0 ? connected : ports.slice(0, 2);
  }, [ports, connectedPortIds, shouldCollapse, expanded]);

  const hiddenCount = ports.length - visiblePorts.length;

  return (
    <div className="border-t border-default-200 transition-all duration-300">
      <div className="flex flex-col">
        {visiblePorts.map((port) => {
          const isConnected = connectedPortIds.has(port.id);
          return (
            <PortRow
              key={port.id}
              port={port}
              isConnected={isConnected}
              isDimmed={!isConnected}
            />
          );
        })}
      </div>
      {shouldCollapse && hiddenCount > 0 && !expanded && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="flex w-full items-center justify-center gap-1 py-1.5 text-[10px] font-medium text-default-400 hover:bg-white/5 hover:text-foreground transition-colors border-t border-white/5"
        >
          <ChevronDown className="h-3 w-3" />
          {t('deviceNode.showAllPorts').replace('{count}', String(hiddenCount))}
        </button>
      )}
      {shouldCollapse && expanded && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
          className="flex w-full items-center justify-center gap-1 py-1 text-[9.5px] font-medium text-default-500 hover:bg-white/5 hover:text-foreground transition-colors border-t border-white/5"
        >
          <ChevronUp className="h-3 w-3" />
          {t('deviceNode.collapseUnused')}
        </button>
      )}
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
function DeviceThumb({
  device,
  className,
  dimFallback,
}: {
  device: Pick<GraphDevice, 'imageUrl' | 'type'>;
  className: string;
  /** Applies the unified fallback-icon presentation (32×32, 50% opacity) instead of the caller's
   *  own size — used for accessory rows, where a missing photo shouldn't look like a real photo. */
  dimFallback?: boolean;
}) {
  if (device.imageUrl) {
    const thumbSrc = isStorageImage(device.imageUrl)
      ? `/img/${device.imageUrl}?w=128`
      : device.imageUrl;
    return <img src={thumbSrc} alt="" className={`shrink-0 aspect-square rounded object-contain object-center bg-black/20 p-0.5 ${className}`} />;
  }
  return <DeviceTypeIcon type={device.type} className={`shrink-0 aspect-square text-default-500 ${dimFallback ? FALLBACK_ICON_CLASS : className}`} />;
}

function DeviceNodeImpl({ data, selected }: NodeProps) {
  const { t, language } = useI18n();
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
        {!device.imageUrl && <DeviceThumb device={device} className="h-6 w-6" />}
        <span className="truncate font-semibold text-foreground" title={device.type}>
          {getDisplayName(device, t, language)}
        </span>
      </div>
      <div className="flex items-center gap-1 px-2.5 pb-1.5 pt-1">
        <Chip size="sm" color={STATUS_COLOR[device.inventoryStatus]} variant="soft">
          {t(({
            [InventoryStatus.OWNED_ACTIVE]: 'status.ownedActive',
            [InventoryStatus.OWNED_INACTIVE]: 'status.ownedInactive',
            [InventoryStatus.PLANNED_NOT_OWNED]: 'status.planned',
            [InventoryStatus.VENUE_PROVIDED]: 'status.venueProvided',
          } as Record<string, import('../lib/i18n/dictionaries').TranslationKey>)[device.inventoryStatus] ?? 'status.ownedActive')}
        </Chip>
      </div>
      {device.ownerRole && <div className="px-2.5 pb-1.5 text-[10px] text-default-500">{formatOwnerRole(device.ownerRole, t)}</div>}
      {ports.length > 0 && <PortsSection ports={ports} connectedPortIds={(data.connectedPortIds as Set<string> | undefined) ?? new Set()} />}
      {isContainer && (
        <>
          {/* Always show external boundary ports — foldable hid Handles so cables
              could not attach / were invisible on the main canvas. */}
          {boundaryPorts.length > 0 && (
            <div className="border-t border-default-200">
              <div className="px-2.5 py-1 text-[9px] font-medium uppercase tracking-wide text-default-500">
                {t('deviceNode.externalConnections').replace('{count}', String(boundaryPorts.length))}
              </div>
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
              {t('deviceNode.openInside').replace('{count}', String(portedChildren.length))}
            </button>
          </div>
        </>
      )}
      {plainChildren.length > 0 && (
        <div className="border-t border-default-200 bg-black/10 px-2 py-1.5">
          <div className="mb-1 text-[9px] font-medium uppercase tracking-wide text-default-500">{t('deviceNode.kitAccessories')}</div>
          <div className="flex flex-col gap-0.5">
            {plainChildren.map((child) => (
              <button
                key={child.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectChild(child.id);
                }}
                className="flex items-center gap-2 rounded p-1 text-left hover:bg-white/10"
                title={formatI18nText(child.notes ?? child.name, language)}
              >
                <DeviceThumb device={child} className="h-8 w-8" dimFallback />
                <span className="truncate text-xs font-medium text-foreground/90">{getDisplayName(child, t, language)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DeviceNodeImpl);
