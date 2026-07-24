import { Button, Disclosure, Input } from '@heroui/react';
import { CABLE_COLORS, InventoryStatus } from '@resopatch/shared';
import { Cable as CableIcon, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GraphCable, GraphDevice } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import { getDisplayName } from '../lib/deviceNaming';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n/dictionaries';
import { FALLBACK_ICON_CLASS } from '../lib/iconDefaults';

/** Same fallback-to-type-icon convention as DeviceNode's thumbnail — kept as its own tiny
 *  component here rather than shared, since Sidebar and DeviceNode intentionally have no
 *  dependency on each other's internals. Storage images are fetched through /img/?w=64
 *  so the browser doesn't download a full-res photo just to show a 16×16 icon. */
function DeviceThumb({ device, className }: { device: Pick<GraphDevice, 'imageUrl' | 'type'>; className: string }) {
  if (device.imageUrl) {
    const isStorage = !device.imageUrl.startsWith('data:') && !/^https?:\/\//i.test(device.imageUrl);
    const src = isStorage ? `/img/${device.imageUrl}?w=128` : device.imageUrl;
    return <img src={src} alt="" className={`shrink-0 aspect-square rounded object-contain bg-black/20 p-0.5 ${className}`} />;
  }
  return <DeviceTypeIcon type={device.type} className={`shrink-0 aspect-square text-default-500 ${FALLBACK_ICON_CLASS}`} />;
}

const GROUPS: { status: string; titleKey: TranslationKey }[] = [
  { status: InventoryStatus.OWNED_ACTIVE, titleKey: 'sidebar.group.ownedActive' },
  { status: InventoryStatus.OWNED_INACTIVE, titleKey: 'sidebar.group.ownedInactive' },
  { status: InventoryStatus.PLANNED_NOT_OWNED, titleKey: 'sidebar.group.planned' },
  { status: InventoryStatus.VENUE_PROVIDED, titleKey: 'sidebar.group.venueProvided' },
];

const CABLES_GROUP = 'cables';

export default function Sidebar({
  devices,
  cables,
  selectedId,
  onSelect,
  onSelectCable,
  onNewDevice,
}: {
  devices: GraphDevice[];
  cables: GraphCable[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectCable: (id: string) => void;
  onNewDevice: () => void;
}) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    [InventoryStatus.OWNED_ACTIVE]: true,
    [InventoryStatus.OWNED_INACTIVE]: true,
    [InventoryStatus.PLANNED_NOT_OWNED]: true,
    [InventoryStatus.VENUE_PROVIDED]: true,
    [CABLES_GROUP]: false,
  });

  const portToDevice = useMemo(() => {
    const map = new Map<string, GraphDevice>();
    for (const d of devices) for (const p of d.ports) map.set(p.id, d);
    return map;
  }, [devices]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => {
      const name = getDisplayName(d, t, language).toLowerCase();
      return (
        name.includes(q) ||
        d.type.toLowerCase().includes(q) ||
        (d.ownerRole ?? '').toLowerCase().includes(q)
      );
    });
  }, [devices, query, t, language]);

  const filteredCables = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cables;
    return cables.filter((c) => {
      const owner = portToDevice.get(c.sourcePortId)?.ownerRole ?? '';
      return c.cableType.toLowerCase().includes(q) || (c.productName ?? '').toLowerCase().includes(q) || owner.toLowerCase().includes(q);
    });
  }, [cables, query, portToDevice]);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-default-200 bg-surface">
      <div className="flex items-center justify-between gap-2 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-default-500">{t('sidebar.inventory')}</h2>
        <Button size="sm" onPress={onNewDevice}>
          <Plus className="h-3.5 w-3.5" />
          {t('sidebar.addDevice')}
        </Button>
      </div>
      <div className="px-3 pb-2">
        <Input placeholder={t('sidebar.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {GROUPS.map((group) => {
          const items = filtered.filter((d) => d.inventoryStatus === group.status && !d.parentDeviceId);
          if (items.length === 0) return null;
          return (
            <Disclosure
              key={group.status}
              isExpanded={expanded[group.status]}
              onExpandedChange={(v) => setExpanded((c) => ({ ...c, [group.status]: v }))}
              className="px-1"
            >
              <Disclosure.Heading>
                <Disclosure.Trigger className="w-full px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-default-500">
                  {t(group.titleKey)} ({items.length})
                  <Disclosure.Indicator />
                </Disclosure.Trigger>
              </Disclosure.Heading>
              <Disclosure.Content>
                <div className="flex flex-col gap-0.5">
                  {items.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSelect(d.id)}
                      title={d.type}
                      className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-secondary ${
                        selectedId === d.id ? 'border-l-accent bg-surface-secondary' : 'border-l-transparent'
                      }`}
                    >
                      <DeviceThumb device={d} className="h-7 w-7" />
                      <span className="truncate">{getDisplayName(d, t, language)}</span>
                    </button>
                  ))}
                </div>
              </Disclosure.Content>
            </Disclosure>
          );
        })}
        {filteredCables.length > 0 && (
          <Disclosure
            isExpanded={expanded[CABLES_GROUP]}
            onExpandedChange={(v) => setExpanded((c) => ({ ...c, [CABLES_GROUP]: v }))}
            className="px-1"
          >
            <Disclosure.Heading>
              <Disclosure.Trigger className="w-full px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-default-500">
                {t('sidebar.cables')} ({filteredCables.length})
                <Disclosure.Indicator />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <div className="flex flex-col gap-0.5">
                {filteredCables.map((c) => {
                  const owner = portToDevice.get(c.sourcePortId)?.ownerRole;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSelectCable(c.id)}
                      title={c.cableType}
                      className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-secondary ${
                        selectedId === c.id ? 'border-l-accent bg-surface-secondary' : 'border-l-transparent'
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: CABLE_COLORS[c.cableType] }}
                      />
                      <CableIcon className="h-3.5 w-3.5 shrink-0 text-default-500" />
                      <span className="truncate">
                        {c.productName ?? c.cableType} — {c.length}{t('meter')}
                        {owner ? ` · ${owner}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Disclosure.Content>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
