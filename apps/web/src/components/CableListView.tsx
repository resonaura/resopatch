import { useMemo, useState } from 'react';
import { Cable as CableIcon } from 'lucide-react';
import { CABLE_COLORS, CableType } from '@resopatch/shared';
import type { GraphCable, GraphDevice } from '../api/client';
import { cableTypeLabel } from '../lib/cableTypeLabel';
import { useI18n } from '../lib/i18n';
import { formatOwnerRole } from '../lib/ownerRole';
import { FALLBACK_ICON_CLASS } from '../lib/iconDefaults';

const AUDIO_TYPES = new Set<string>([CableType.AUDIO_BALANCED, CableType.AUDIO_UNBALANCED]);
const POWER_TYPES = new Set<string>([CableType.POWER_LINE]);

type Category = 'all' | 'audio' | 'power';

export default function CableListView({ devices, cables }: { devices: GraphDevice[]; cables: GraphCable[] }) {
  const { t } = useI18n();
  const noZone = t('cables.noZone');
  const [category, setCategory] = useState<Category>('all');

  const portToDevice = useMemo(() => {
    const map = new Map<string, GraphDevice>();
    for (const d of devices) for (const p of d.ports) map.set(p.id, d);
    return map;
  }, [devices]);

  const zoneOf = (cable: GraphCable) => portToDevice.get(cable.sourcePortId)?.ownerRole?.trim() || noZone;

  const allZones = useMemo(() => {
    const zones = new Set<string>();
    for (const c of cables) zones.add(zoneOf(c));
    return Array.from(zones).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cables, portToDevice, noZone]);

  const allTypes = useMemo(() => {
    const types = new Set<string>();
    for (const c of cables) types.add(c.cableType);
    return Array.from(types).sort();
  }, [cables]);

  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hiddenZones, setHiddenZones] = useState<Set<string>>(new Set());

  const toggleType = (type: string) =>
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const toggleZone = (z: string) =>
    setHiddenZones((prev) => {
      const next = new Set(prev);
      if (next.has(z)) next.delete(z);
      else next.add(z);
      return next;
    });

  const visibleCables = useMemo(() => {
    return cables.filter((c) => {
      if (category === 'audio' && !AUDIO_TYPES.has(c.cableType)) return false;
      if (category === 'power' && !POWER_TYPES.has(c.cableType)) return false;
      if (hiddenTypes.has(c.cableType)) return false;
      if (hiddenZones.has(zoneOf(c))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cables, category, hiddenTypes, hiddenZones, portToDevice]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background p-4">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center rounded-lg border border-default-200 bg-surface-secondary/80 p-0.5">
          {(
            [
              ['all', t('cables.viewAll')],
              ['audio', t('cables.viewAudio')],
              ['power', t('cables.viewPower')],
            ] as [Category, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                category === key ? 'bg-background text-foreground shadow-sm' : 'text-default-500 hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-default-500">{t('cables.filterType')}</span>
          {allTypes.map((type) => {
            const active = !hiddenTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                title={cableTypeLabel(type, t)}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-opacity ${
                  active ? 'border-default-200 opacity-100' : 'border-default-200 opacity-40'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                  style={{ backgroundColor: CABLE_COLORS[type as CableType] }}
                />
                {cableTypeLabel(type, t)}
              </button>
            );
          })}
        </div>

        {allZones.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-default-500">{t('cables.filterZone')}</span>
            {allZones.map((z) => {
              const active = !hiddenZones.has(z);
              return (
                <label
                  key={z}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border border-default-200 px-2 py-1 text-[11px] transition-opacity ${
                    active ? 'opacity-100' : 'opacity-40'
                  }`}
                >
                  <input type="checkbox" checked={active} onChange={() => toggleZone(z)} className="h-3 w-3" />
                  {z === noZone ? noZone : formatOwnerRole(z, t)}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-default-200 bg-surface shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-default-200 bg-surface-secondary/50 px-4 py-2.5">
          <span className="text-sm font-semibold text-foreground">{t('cables.count', { count: visibleCables.length })}</span>
        </div>
        <div className="divide-y divide-default-100">
          {visibleCables.length === 0 && <div className="p-4 text-sm text-default-500">{t('cables.empty')}</div>}
          {visibleCables.map((c) => {
            const sourceDevice = portToDevice.get(c.sourcePortId);
            const targetDevice = portToDevice.get(c.targetPortId);
            return (
              <div key={c.id} className="flex items-center gap-3 p-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: CABLE_COLORS[c.cableType] }}
                />
                <CableIcon className={`shrink-0 text-default-400 ${FALLBACK_ICON_CLASS}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {c.productName ?? cableTypeLabel(c.cableType, t)} — {c.length}{t('meter')}
                    {c.color ? ` (${c.color})` : ''}
                    {!c.isUserOwned && <span className="ml-2 text-[10px] text-default-500">{t('cables.venueProvided')}</span>}
                  </div>
                  <div className="truncate text-xs text-default-500">
                    {sourceDevice?.name ?? '?'} → {targetDevice?.name ?? '?'} · {zoneOf(c) === noZone ? noZone : formatOwnerRole(zoneOf(c), t)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
