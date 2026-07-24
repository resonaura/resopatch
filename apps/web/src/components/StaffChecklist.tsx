import { Button, Chip } from '@heroui/react';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Cable as CableIcon,
    ChevronDown,
    ChevronRight,
    PackageCheck,
    RotateCcw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type GraphCable, type GraphDevice } from '../api/client';
import { buildAdaptiveCableLabel, cableMetaFromPorts } from '../lib/cableLabel';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import { getDisplayName } from '../lib/deviceNaming';
import type { CableEdgeMeta } from '../lib/graphCableToEdge';
import { useI18n } from '../lib/i18n';
import { formatI18nText } from '../lib/i18nText';
import { FALLBACK_ICON_CLASS } from '../lib/iconDefaults';
import { formatOwnerRole } from '../lib/ownerRole';
import { PortTypeIcon } from '../lib/portIcons';
import CheckboxField from './CheckboxField';

interface CableGroup {
  key: string;
  cableType: string;
  length: number;
  color: string | null;
  productName: string | null;
  quantity: number;
  imageUrl: string | null;
  isPatchCable: boolean;
  isUserOwned: boolean;
  adapterName: string | null;
  sourcePortType: string | null;
  targetPortType: string | null;
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
  return <Thumb imageUrl={device.imageUrl} fallback={<DeviceTypeIcon type={device.type} className={FALLBACK_ICON_CLASS} />} />;
}

/** Pedalboards default collapsed; other parents with kids start expanded. */
function ChecklistDeviceRow({
  parent,
  accessories,
  checkedMap,
  onToggleParent,
  onToggleCheck,
}: {
  parent: GraphDevice;
  accessories: GraphDevice[];
  checkedMap: Record<string, boolean>;
  onToggleParent: (parent: GraphDevice, accessories: GraphDevice[]) => void;
  onToggleCheck: (id: string) => void;
}) {
  const { t, language } = useI18n();
  const isPedalboard = parent.type === DeviceType.PEDALBOARD;
  const [open, setOpen] = useState(!isPedalboard);
  const isChecked = !!checkedMap[parent.id];
  const hasKids = accessories.length > 0;

  return (
    <div
      className={`p-3.5 transition-colors ${isChecked ? 'bg-accent/5' : 'hover:bg-surface-secondary/30'}`}
    >
      <div className="flex items-start gap-3">
        <div onClick={(e) => e.stopPropagation()}>
          <CheckboxField
            isSelected={isChecked}
            onChange={() => onToggleParent(parent, accessories)}
            className="mt-1"
          />
        </div>

        <ItemThumb device={parent} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {hasKids && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((v) => !v);
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-default-500 hover:bg-default-100 hover:text-foreground"
                aria-expanded={open}
                title={open ? t('deviceNode.collapseUnused') : t('deviceNode.showAllPorts').replace('{count}', String(accessories.length))}
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onToggleParent(parent, accessories)}
              className={`text-left font-semibold text-sm ${isChecked ? 'line-through text-default-400' : 'text-foreground'}`}
            >
              {getDisplayName(parent, t, language)}
            </button>
            <Chip size="sm" variant="soft" className="text-[10px]">
              {parent.type}
            </Chip>
            {hasKids && (
              <span className="text-[10px] text-default-500">
                {t('checklist.kit')} · {accessories.length}
              </span>
            )}
            {parent.inventoryStatus !== InventoryStatus.OWNED_ACTIVE && (
              <Chip size="sm" variant="soft" className="text-[10px]">
                {parent.inventoryStatus}
              </Chip>
            )}
          </div>

          {parent.notes && (
            <p className="mt-1 text-xs text-default-500">{formatI18nText(parent.notes, language)}</p>
          )}

          {hasKids && open && (
            <div className="mt-3 flex flex-col gap-1.5 border-l-2 border-accent/40 pl-3">
              <div className="text-[11px] font-medium text-default-500 uppercase tracking-wide">
                {t('checklist.kit')} ({accessories.length}):
              </div>
              {accessories.map((acc) => {
                const accChecked = !!checkedMap[acc.id];
                return (
                  <div
                    key={acc.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCheck(acc.id);
                    }}
                    className="flex cursor-pointer items-center gap-2 py-0.5"
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <CheckboxField
                        isSelected={accChecked}
                        onChange={() => onToggleCheck(acc.id)}
                      />
                    </div>
                    <ItemThumb device={acc} />
                    <span
                      className={`text-xs ${accChecked ? 'line-through text-default-400' : 'text-foreground'}`}
                    >
                      {getDisplayName(acc, t, language)}
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
}

export default function StaffChecklist({ devices, cables, setupId }: { devices: GraphDevice[]; cables: GraphCable[]; setupId: string }) {
  const { t, language } = useI18n();
  const unowned = t('checklist.unowned');
  const qc = useQueryClient();
  const storageKey = `resopatch_checklist_${setupId}`;
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Cloud sync: the setup's `checklistState` is the source of truth once loaded (falls back to
  // whatever's in localStorage until then, so this still works offline / before first sync).
  // Writes are debounced and pushed to the server; other connected clients pick them up via the
  // WebSocket-driven `['setup', setupId]` invalidation in lib/sync.ts.
  const setupQuery = useQuery({ queryKey: ['setup', setupId], queryFn: () => api.getSetup(setupId) });
  const lastSyncedRemote = useRef<Record<string, boolean> | null>(null);
  useEffect(() => {
    const remote = setupQuery.data?.checklistState;
    if (remote && remote !== lastSyncedRemote.current) {
      lastSyncedRemote.current = remote;
      setCheckedMap(remote);
    }
  }, [setupQuery.data]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChecklistState = useMutation({
    mutationFn: (state: Record<string, boolean>) => api.updateSetup(setupId, { checklistState: state }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup', setupId] }),
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(checkedMap));
    } catch {
      // ignore
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      lastSyncedRemote.current = checkedMap;
      saveChecklistState.mutate(checkedMap);
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedMap, storageKey]);

  const toggleCheck = (id: string) => {
    setCheckedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Checking/unchecking a parent device (e.g. the pedalboard) carries its accessories along —
  // you don't pack the board without the pedals bolted to it.
  const toggleParent = (parent: GraphDevice, accessories: GraphDevice[]) => {
    setCheckedMap((prev) => {
      const next = { ...prev, [parent.id]: !prev[parent.id] };
      for (const acc of accessories) next[acc.id] = next[parent.id];
      return next;
    });
  };

  const resetAll = () => {
    if (confirm(t('checklist.confirmReset'))) {
      setCheckedMap({});
    }
  };

  const portToDevice = useMemo(() => {
    const map = new Map<string, GraphDevice>();
    for (const d of devices) {
      for (const p of d.ports) map.set(p.id, d);
    }
    return map;
  }, [devices]);

  const portById = useMemo(() => {
    const map = new Map<string, GraphDevice['ports'][number]>();
    for (const d of devices) {
      for (const p of d.ports) map.set(p.id, p);
    }
    return map;
  }, [devices]);

  // Group top-level devices and their accessories by Owner (excluding venue-provided items)
  const devicesByOwner = useMemo(() => {
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
      const owner = parent.ownerRole?.trim() || unowned;
      const list = groups.get(owner) ?? [];
      list.push({
        parent,
        accessories: childrenMap.get(parent.id) ?? [],
      });
      groups.set(owner, list);
    }

    return groups;
  }, [devices, unowned]);

  // Cables to pack: user-owned physical cables (excludes venue-provided runs and wireless
  // control links). Group by owner + connector ends + length/color/product so the checklist
  // line matches the on-wire caption (XLR · папа-мама · 3m · …).
  const cableGroupsByOwner = useMemo(() => {
    const groups = new Map<string, Map<string, CableGroup>>();
    for (const c of cables) {
      if (!c.isUserOwned || c.cableType === 'CONTROL_LINK') continue;
      const owner = portToDevice.get(c.sourcePortId)?.ownerRole?.trim() || unowned;
      const ownerGroups = groups.get(owner) ?? new Map<string, CableGroup>();
      const srcType = portById.get(c.sourcePortId)?.portType ?? null;
      const tgtType = portById.get(c.targetPortId)?.portType ?? null;
      const key = [
        c.cableType,
        c.length,
        c.color ?? '',
        c.productName ?? '',
        srcType ?? '',
        tgtType ?? '',
        c.isPatchCable ? '1' : '0',
        c.adapterName ?? '',
      ].join('|');
      const group =
        ownerGroups.get(key) ??
        ({
          key,
          cableType: c.cableType,
          length: c.length,
          color: c.color,
          productName: c.productName,
          quantity: 0,
          imageUrl: null,
          isPatchCable: c.isPatchCable,
          isUserOwned: c.isUserOwned,
          adapterName: c.adapterName ?? null,
          sourcePortType: srcType,
          targetPortType: tgtType,
        } satisfies CableGroup);
      group.quantity += 1;
      if (!group.imageUrl && c.imageUrl) group.imageUrl = c.imageUrl;
      ownerGroups.set(key, group);
      groups.set(owner, ownerGroups);
    }
    const result = new Map<string, CableGroup[]>();
    for (const [owner, ownerGroups] of groups) {
      result.set(
        owner,
        Array.from(ownerGroups.values()).sort((a, b) => a.cableType.localeCompare(b.cableType) || a.length - b.length),
      );
    }
    return result;
  }, [cables, portToDevice, portById, unowned]);

  const allCableGroups = useMemo(() => Array.from(cableGroupsByOwner.values()).flat(), [cableGroupsByOwner]);
  const cableChecked = allCableGroups.filter((g) => checkedMap[`cable:${g.key}`]).length;

  // Union of everyone who owns either a device or a cable, in first-seen order.
  const owners = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const owner of devicesByOwner.keys()) {
      if (!seen.has(owner)) {
        seen.add(owner);
        list.push(owner);
      }
    }
    for (const owner of cableGroupsByOwner.keys()) {
      if (!seen.has(owner)) {
        seen.add(owner);
        list.push(owner);
      }
    }
    return list;
  }, [devicesByOwner, cableGroupsByOwner]);

  // Compute total checkable items count
  const allCheckableItems = useMemo(() => {
    return devices.filter((d) => d.inventoryStatus !== InventoryStatus.VENUE_PROVIDED);
  }, [devices]);

  const checkedCount = useMemo(() => {
    return allCheckableItems.filter((item) => checkedMap[item.id]).length + cableChecked;
  }, [allCheckableItems, checkedMap, cableChecked]);

  const totalCheckableCount = allCheckableItems.length + allCableGroups.length;
  const progressPercent = totalCheckableCount > 0 ? Math.round((checkedCount / totalCheckableCount) * 100) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background p-4 overflow-y-auto">
      {/* Header Summary */}
      <div className="mb-6 shrink-0 rounded-xl border border-default-200 bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('checklist.title')}</h2>
              <p className="text-xs text-default-500">{t('checklist.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-foreground">
                {t('checklist.progress', { checked: checkedCount, total: totalCheckableCount })}
              </div>
              <div className="text-xs text-default-500">{t('checklist.readiness', { percent: progressPercent })}</div>
            </div>
            <Button size="sm" variant="secondary" onPress={resetAll}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t('checklist.reset')}
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

      {/* Checklist Groups by Owner */}
      <div className="flex flex-col gap-6">
        {owners.map((owner) => {
          const items = devicesByOwner.get(owner) ?? [];
          const ownerCables = cableGroupsByOwner.get(owner) ?? [];

          const deviceTotal = items.reduce((acc, curr) => acc + 1 + curr.accessories.length, 0);
          const deviceChecked = items.reduce((acc, curr) => {
            let c = checkedMap[curr.parent.id] ? 1 : 0;
            for (const accItem of curr.accessories) {
              if (checkedMap[accItem.id]) c++;
            }
            return acc + c;
          }, 0);
          const ownerCableChecked = ownerCables.filter((g) => checkedMap[`cable:${g.key}`]).length;
          const groupTotal = deviceTotal + ownerCables.length;
          const groupChecked = deviceChecked + ownerCableChecked;

          return (
            <div key={owner} className="rounded-xl border border-default-200 bg-surface shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-default-200 bg-surface-secondary/50 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{owner === unowned ? unowned : formatOwnerRole(owner, t)}</span>
                  <Chip size="sm" variant="soft">
                    {groupChecked}/{groupTotal}
                  </Chip>
                </div>
              </div>

              <div className="divide-y divide-default-100">
                {items.map(({ parent, accessories }) => (
                  <ChecklistDeviceRow
                    key={parent.id}
                    parent={parent}
                    accessories={accessories}
                    checkedMap={checkedMap}
                    onToggleParent={toggleParent}
                    onToggleCheck={toggleCheck}
                  />
                ))}

                {/* Cables belonging to this owner */}
                {ownerCables.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
                      <CableIcon className="h-3 w-3 text-default-500" />
                      <span className="text-[11px] font-medium text-default-500 uppercase tracking-wide">
                        {t('checklist.cables')} ({ownerCables.length}):
                      </span>
                    </div>
                    {ownerCables.map((group) => {
                      const storageKeyForGroup = `cable:${group.key}`;
                      const isChecked = !!checkedMap[storageKeyForGroup];
                      const meta: CableEdgeMeta = cableMetaFromPorts(
                        {
                          cableType: group.cableType,
                          length: group.length,
                          color: group.color,
                          productName: group.productName,
                          isPatchCable: group.isPatchCable,
                          isUserOwned: group.isUserOwned,
                          adapterName: group.adapterName,
                        },
                        group.sourcePortType,
                        group.targetPortType,
                      );
                      const label = buildAdaptiveCableLabel(meta, t, language, 10_000);
                      const iconPorts = label?.iconPorts ?? [];
                      const title = label?.fullText || label?.text || group.cableType;
                      return (
                        <div
                          key={group.key}
                          onClick={() => toggleCheck(storageKeyForGroup)}
                          className={`flex cursor-pointer items-center gap-3 p-3.5 transition-colors ${isChecked ? 'bg-accent/5' : 'hover:bg-surface-secondary/30'}`}
                        >
                          <div onClick={(e) => e.stopPropagation()}>
                            <CheckboxField isSelected={isChecked} onChange={() => toggleCheck(storageKeyForGroup)} />
                          </div>
                          <Thumb
                            imageUrl={group.imageUrl}
                            fallback={
                              iconPorts.length > 0 ? (
                                <span className="flex items-center gap-0.5">
                                  {iconPorts.map((pt, i) => (
                                    <PortTypeIcon key={`${pt}-${i}`} portType={pt} className="h-4 w-4" />
                                  ))}
                                </span>
                              ) : (
                                <CableIcon className={FALLBACK_ICON_CLASS} />
                              )
                            }
                          />
                          <Chip size="sm" variant="soft" className="shrink-0">
                            x{group.quantity}
                          </Chip>
                          <div className="min-w-0 flex-1">
                            <div
                              className={`flex flex-wrap items-center gap-1.5 text-sm font-semibold ${
                                isChecked ? 'line-through text-default-400' : 'text-foreground'
                              }`}
                              title={title}
                            >
                              {iconPorts.map((pt, i) => (
                                <PortTypeIcon key={`row-${pt}-${i}`} portType={pt} className="h-3.5 w-3.5 shrink-0" />
                              ))}
                              <span className="min-w-0">{title}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
