import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { Button, Chip } from '@heroui/react';
import { RotateCcw, PackageCheck, Cable as CableIcon } from 'lucide-react';
import { InventoryStatus } from '@resopatch/shared';
import type { GraphCable, GraphDevice } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import CheckboxField from './CheckboxField';

const CABLE_TYPE_LABEL: Record<string, string> = {
  AUDIO_BALANCED: 'Аудио (балансный)',
  AUDIO_UNBALANCED: 'Аудио (небалансный)',
  MIDI: 'MIDI',
  USB_DATA: 'USB',
  POWER_LINE: 'Питание',
  CONTROL_LINK: 'Control link',
};

interface CableGroup {
  key: string;
  cableType: string;
  length: number;
  color: string | null;
  quantity: number;
  imageUrl: string | null;
}

function isStorageImage(url: string): boolean {
  return !url.startsWith('data:') && !/^https?:\/\//i.test(url);
}

function Thumb({ imageUrl, fallback }: { imageUrl: string | null | undefined; fallback: ReactNode }) {
  if (imageUrl) {
    const src = isStorageImage(imageUrl) ? `/img/${imageUrl}?w=128` : imageUrl;
    return (
      <img
        src={src}
        alt=""
        className="h-12 w-12 shrink-0 aspect-square rounded-lg object-contain bg-black/30 p-1 border border-default-200"
      />
    );
  }
  return (
    <div className="flex h-12 w-12 shrink-0 aspect-square items-center justify-center rounded-lg bg-default-100 border border-default-200 text-default-500">
      {fallback}
    </div>
  );
}

function ItemThumb({ device }: { device: Pick<GraphDevice, 'imageUrl' | 'type'> }) {
  return <Thumb imageUrl={device.imageUrl} fallback={<DeviceTypeIcon type={device.type} className="h-6 w-6" />} />;
}

export default function StaffChecklist({ devices, cables, setupId }: { devices: GraphDevice[]; cables: GraphCable[]; setupId: string }) {
  const storageKey = `resopatch_checklist_${setupId}`;
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(checkedMap));
    } catch {
      // ignore
    }
  }, [checkedMap, storageKey]);

  const toggleCheck = (id: string) => {
    setCheckedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const resetAll = () => {
    if (confirm('Сбросить все отметки в чеклисте?')) {
      setCheckedMap({});
    }
  };

  // Group top-level devices and their accessories by Owner (excluding venue-provided items)
  const grouped = useMemo(() => {
    const bandDevices = devices.filter((d) => d.inventoryStatus !== InventoryStatus.VENUE_PROVIDED);
    const parentDevices = bandDevices.filter((d) => !d.parentDeviceId);
    const childrenMap = new Map<string, GraphDevice[]>();

    for (const d of bandDevices) {
      if (d.parentDeviceId) {
        const list = childrenMap.get(d.parentDeviceId) ?? [];
        list.push(d);
        childrenMap.set(d.parentDeviceId, list);
      }
    }

    const groups = new Map<string, { parent: GraphDevice; accessories: GraphDevice[] }[]>();

    for (const parent of parentDevices) {
      const owner = parent.ownerRole?.trim() || 'Общее оборудование';
      const list = groups.get(owner) ?? [];
      list.push({
        parent,
        accessories: childrenMap.get(parent.id) ?? [],
      });
      groups.set(owner, list);
    }

    return groups;
  }, [devices]);

  // Cables to pack: user-owned physical cables (excludes venue-provided runs and wireless
  // control links, which aren't things you throw in a bag), grouped by type/length/color so
  // e.g. "6x XLR 3m blue" shows as one row instead of six.
  const cableGroups = useMemo(() => {
    const groups = new Map<string, CableGroup>();
    for (const c of cables) {
      if (!c.isUserOwned || c.cableType === 'CONTROL_LINK') continue;
      const key = `${c.cableType}|${c.length}|${c.color ?? ''}`;
      const group = groups.get(key) ?? { key, cableType: c.cableType, length: c.length, color: c.color, quantity: 0, imageUrl: null };
      group.quantity += 1;
      if (!group.imageUrl && c.imageUrl) group.imageUrl = c.imageUrl;
      groups.set(key, group);
    }
    return Array.from(groups.values()).sort((a, b) => a.cableType.localeCompare(b.cableType) || a.length - b.length);
  }, [cables]);

  const cableChecked = cableGroups.filter((g) => checkedMap[`cable:${g.key}`]).length;

  // Compute total checkable items count
  const allCheckableItems = useMemo(() => {
    return devices.filter((d) => d.inventoryStatus !== InventoryStatus.VENUE_PROVIDED);
  }, [devices]);

  const checkedCount = useMemo(() => {
    return allCheckableItems.filter((item) => checkedMap[item.id]).length + cableChecked;
  }, [allCheckableItems, checkedMap, cableChecked]);

  const totalCheckableCount = allCheckableItems.length + cableGroups.length;
  const progressPercent = totalCheckableCount > 0 ? Math.round((checkedCount / totalCheckableCount) * 100) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background p-4 overflow-y-auto">
      {/* Header Summary */}
      <div className="mb-6 rounded-xl border border-default-200 bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Чеклист стаффа (концертный сбор)</h2>
              <p className="text-xs text-default-500">Проверьте оборудование и аксессуары перед выездом на площадку</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-foreground">
                {checkedCount} из {totalCheckableCount} собрано
              </div>
              <div className="text-xs text-default-500">{progressPercent}% готовности</div>
            </div>
            <Button size="sm" variant="secondary" onPress={resetAll}>
              <RotateCcw className="h-3.5 w-3.5" />
              Сбросить
            </Button>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-default-200">
          <div
            className={`h-full transition-all duration-300 ${progressPercent === 100 ? 'bg-success' : 'bg-accent'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Cables */}
      {cableGroups.length > 0 && (
        <div className="mb-6 rounded-xl border border-default-200 bg-surface shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-default-200 bg-surface-secondary/50 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <CableIcon className="h-3.5 w-3.5 text-default-500" />
              <span className="font-semibold text-sm text-foreground">Кабели</span>
              <Chip size="sm" variant="soft">
                {cableChecked}/{cableGroups.length}
              </Chip>
            </div>
          </div>
          <div className="divide-y divide-default-100">
            {cableGroups.map((group) => {
              const storageKeyForGroup = `cable:${group.key}`;
              const isChecked = !!checkedMap[storageKeyForGroup];
              return (
                <div
                  key={group.key}
                  className={`flex items-center gap-3 p-3.5 transition-colors ${isChecked ? 'bg-accent/5' : 'hover:bg-surface-secondary/30'}`}
                >
                  <CheckboxField isSelected={isChecked} onChange={() => toggleCheck(storageKeyForGroup)} />
                  <Thumb imageUrl={group.imageUrl} fallback={<CableIcon className="h-5 w-5" />} />
                  <div className="min-w-0 flex-1">
                    <span className={`font-semibold text-sm ${isChecked ? 'line-through text-default-400' : 'text-foreground'}`}>
                      {CABLE_TYPE_LABEL[group.cableType] ?? group.cableType} — {group.length}м
                      {group.color ? ` (${group.color})` : ''}
                    </span>
                  </div>
                  <Chip size="sm" variant="soft" className="shrink-0">
                    x{group.quantity}
                  </Chip>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Checklist Groups by Owner */}
      <div className="flex flex-col gap-6">
        {Array.from(grouped.entries()).map(([owner, items]) => {
          const groupTotal = items.reduce((acc, curr) => acc + 1 + curr.accessories.length, 0);
          const groupChecked = items.reduce((acc, curr) => {
            let c = checkedMap[curr.parent.id] ? 1 : 0;
            for (const accItem of curr.accessories) {
              if (checkedMap[accItem.id]) c++;
            }
            return acc + c;
          }, 0);

          return (
            <div key={owner} className="rounded-xl border border-default-200 bg-surface shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-default-200 bg-surface-secondary/50 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{owner}</span>
                  <Chip size="sm" variant="soft">
                    {groupChecked}/{groupTotal}
                  </Chip>
                </div>
              </div>

              <div className="divide-y divide-default-100">
                {items.map(({ parent, accessories }) => {
                  const isChecked = !!checkedMap[parent.id];

                  return (
                    <div
                      key={parent.id}
                      className={`p-3.5 transition-colors ${isChecked ? 'bg-accent/5' : 'hover:bg-surface-secondary/30'}`}
                    >
                      <div className="flex items-start gap-3">
                        <CheckboxField
                          isSelected={isChecked}
                          onChange={() => toggleCheck(parent.id)}
                          className="mt-1"
                        />

                        <ItemThumb device={parent} />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`font-semibold text-sm ${isChecked ? 'line-through text-default-400' : 'text-foreground'}`}>
                              {parent.name}
                            </span>
                            <Chip size="sm" variant="soft" className="text-[10px]">
                              {parent.type}
                            </Chip>
                            {parent.inventoryStatus !== InventoryStatus.OWNED_ACTIVE && (
                              <Chip size="sm" variant="soft" className="text-[10px]">
                                {parent.inventoryStatus}
                              </Chip>
                            )}
                          </div>

                          {parent.notes && <p className="mt-1 text-xs text-default-500">{parent.notes}</p>}

                          {/* Accessories & Child Devices */}
                          {accessories.length > 0 && (
                            <div className="mt-3 flex flex-col gap-1.5 border-l-2 border-accent/40 pl-3">
                              <div className="text-[11px] font-medium text-default-500 uppercase tracking-wide">
                                Комплект / Аксессуары ({accessories.length}):
                              </div>
                              {accessories.map((acc) => {
                                const accChecked = !!checkedMap[acc.id];
                                return (
                                  <div key={acc.id} className="flex items-center gap-2 py-0.5">
                                    <CheckboxField
                                      isSelected={accChecked}
                                      onChange={() => toggleCheck(acc.id)}
                                    />
                                    <ItemThumb device={acc} />
                                    <span className={`text-xs ${accChecked ? 'line-through text-default-400' : 'text-foreground'}`}>
                                      {acc.name}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
