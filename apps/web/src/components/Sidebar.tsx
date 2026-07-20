import { useMemo, useState } from 'react';
import { InventoryStatus } from '@resopatch/shared';
import type { GraphDevice } from '../api/client';

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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) => d.name.toLowerCase().includes(q) || d.type.toLowerCase().includes(q) || (d.ownerRole ?? '').toLowerCase().includes(q),
    );
  }, [devices, query]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Инвентарь</h2>
        <button className="btn-primary" onClick={onNewDevice}>
          + Устройство
        </button>
      </div>
      <input className="sidebar-search" placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="sidebar-list">
        {GROUPS.map((group) => {
          const items = filtered.filter((d) => d.inventoryStatus === group.status && !d.parentDeviceId);
          if (items.length === 0) return null;
          const isCollapsed = collapsed[group.status];
          return (
            <div key={group.status} className="sidebar-group">
              <button className="sidebar-group-title" onClick={() => setCollapsed((c) => ({ ...c, [group.status]: !c[group.status] }))}>
                {isCollapsed ? '▸' : '▾'} {group.title} ({items.length})
              </button>
              {!isCollapsed &&
                items.map((d) => (
                  <button key={d.id} className={`sidebar-item ${selectedId === d.id ? 'selected' : ''}`} onClick={() => onSelect(d.id)}>
                    <span className="sidebar-item-name">{d.name}</span>
                    <span className="sidebar-item-type">{d.type}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
