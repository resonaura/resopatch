import { useMemo, useState } from 'react';
import { Button, Disclosure, Input } from '@heroui/react';
import { Plus } from 'lucide-react';
import { InventoryStatus } from '@resopatch/shared';
import type { GraphDevice } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';

const GROUPS: { status: string; title: string }[] = [
  { status: InventoryStatus.OWNED_ACTIVE, title: 'В сетапе' },
  { status: InventoryStatus.OWNED_INACTIVE, title: 'Есть, не активно' },
  { status: InventoryStatus.PLANNED_NOT_OWNED, title: 'В планах' },
  { status: InventoryStatus.VENUE_PROVIDED, title: 'От площадки' },
];

export default function Sidebar({
  devices,
  selectedId,
  onSelect,
  onNewDevice,
}: {
  devices: GraphDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewDevice: () => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    [InventoryStatus.OWNED_ACTIVE]: true,
    [InventoryStatus.OWNED_INACTIVE]: true,
    [InventoryStatus.PLANNED_NOT_OWNED]: true,
    [InventoryStatus.VENUE_PROVIDED]: true,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) => d.name.toLowerCase().includes(q) || d.type.toLowerCase().includes(q) || (d.ownerRole ?? '').toLowerCase().includes(q),
    );
  }, [devices, query]);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-default-200 bg-surface">
      <div className="flex items-center justify-between gap-2 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-default-500">Инвентарь</h2>
        <Button size="sm" onPress={onNewDevice}>
          <Plus className="h-3.5 w-3.5" />
          Устройство
        </Button>
      </div>
      <div className="px-3 pb-2">
        <Input placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                  {group.title} ({items.length})
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
                      <DeviceTypeIcon type={d.type} className="h-3.5 w-3.5 shrink-0 text-default-500" />
                      <span className="truncate">{d.name}</span>
                    </button>
                  ))}
                </div>
              </Disclosure.Content>
            </Disclosure>
          );
        })}
      </div>
    </div>
  );
}
