/**
 * Cable visibility filters for the main patch canvas.
 * Type chips are connector-oriented (XLR, TS/TRS ¼″/⅛″, MIDI, USB, power…) —
 * not cable-medium labels like “balanced / unbalanced”.
 */
import { CableType, PortType } from '@resopatch/shared';
import { useMemo } from 'react';
import type { GraphCable, GraphDevice } from '../api/client';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n/dictionaries';
import { formatOwnerRole } from '../lib/ownerRole';
import { PortTypeIcon } from '../lib/portIcons';

export type CableCategory = 'all' | 'audio' | 'power';

/** User-facing connector groups used as filter chips. */
export type ConnectorFilterId =
  | 'xlr'
  | 'trs_14'
  | 'ts_14'
  | 'trs_18'
  | 'trrs_18'
  | 'midi'
  | 'usb'
  | 'dc'
  | 'mains'
  | 'wireless';

const AUDIO_TYPES = new Set<string>([CableType.AUDIO_BALANCED, CableType.AUDIO_UNBALANCED]);
const POWER_TYPES = new Set<string>([CableType.POWER_LINE]);

/** Stable display order for connector chips. */
const CONNECTOR_ORDER: ConnectorFilterId[] = [
  'xlr',
  'trs_14',
  'ts_14',
  'trs_18',
  'trrs_18',
  'midi',
  'usb',
  'dc',
  'mains',
  'wireless',
];

const CONNECTOR_LABEL_KEY: Record<ConnectorFilterId, TranslationKey> = {
  xlr: 'connectorFilter.xlr',
  trs_14: 'connectorFilter.trs14',
  ts_14: 'connectorFilter.ts14',
  trs_18: 'connectorFilter.trs18',
  trrs_18: 'connectorFilter.trrs18',
  midi: 'connectorFilter.midi',
  usb: 'connectorFilter.usb',
  dc: 'connectorFilter.dc',
  mains: 'connectorFilter.mains',
  wireless: 'connectorFilter.wireless',
};

/** Representative PortType for the chip icon. */
const CONNECTOR_ICON_PORT: Record<ConnectorFilterId, PortType> = {
  xlr: PortType.XLR_F,
  trs_14: PortType.TRS_14,
  ts_14: PortType.TS_14,
  trs_18: PortType.TRS_18,
  trrs_18: PortType.TRRS_18,
  midi: PortType.MIDI_DIN,
  usb: PortType.USB_C,
  dc: PortType.DC_BARREL,
  mains: PortType.POWER_SCHUKO,
  wireless: PortType.WIRELESS,
};

/** Accent color for the chip dot (not the cable stroke). */
const CONNECTOR_DOT: Record<ConnectorFilterId, string> = {
  xlr: '#3b82f6',
  trs_14: '#22c55e',
  ts_14: '#84cc16',
  trs_18: '#14b8a6',
  trrs_18: '#06b6d4',
  midi: '#a855f7',
  usb: '#6366f1',
  dc: '#f59e0b',
  mains: '#ef4444',
  wireless: '#94a3b8',
};

/** Map a physical port type to one or more filter groups. Combo jacks contribute both families. */
export function connectorGroupsForPortType(portType: string): ConnectorFilterId[] {
  switch (portType) {
    case PortType.XLR_M:
    case PortType.XLR_F:
      return ['xlr'];
    case PortType.COMBO_XLR_TRS:
      return ['xlr', 'trs_14'];
    case PortType.TRS_14:
      return ['trs_14'];
    case PortType.TS_14:
      return ['ts_14'];
    case PortType.TRS_18:
      return ['trs_18'];
    case PortType.TRRS_18:
      return ['trrs_18'];
    case PortType.MIDI_DIN:
      return ['midi'];
    case PortType.USB_C:
    case PortType.USB_A:
    case PortType.USB_B:
      return ['usb'];
    case PortType.DC_BARREL:
      return ['dc'];
    case PortType.POWER_IEC:
    case PortType.POWER_SCHUKO:
      return ['mains'];
    case PortType.WIRELESS:
      return ['wireless'];
    default:
      return [];
  }
}

export function connectorGroupsForCable(
  cable: GraphCable,
  portById: Map<string, { portType: string }>,
): ConnectorFilterId[] {
  const groups = new Set<ConnectorFilterId>();
  const source = portById.get(cable.sourcePortId);
  const target = portById.get(cable.targetPortId);
  if (source) for (const g of connectorGroupsForPortType(source.portType)) groups.add(g);
  if (target) for (const g of connectorGroupsForPortType(target.portType)) groups.add(g);
  return Array.from(groups);
}

export type CableFilterState = {
  category: CableCategory;
  /** Hidden connector groups (chip dimmed). */
  hiddenConnectors: Set<string>;
  hiddenZones: Set<string>;
};

export function cablePassesFilters(
  cable: GraphCable,
  zone: string,
  filters: CableFilterState,
  portById: Map<string, { portType: string }>,
): boolean {
  if (filters.category === 'audio' && !AUDIO_TYPES.has(cable.cableType)) return false;
  if (filters.category === 'power' && !POWER_TYPES.has(cable.cableType)) return false;
  if (filters.hiddenZones.has(zone)) return false;

  if (filters.hiddenConnectors.size > 0) {
    const groups = connectorGroupsForCable(cable, portById);
    // No known connector → keep visible (don't hide mystery cables).
    if (groups.length > 0 && groups.every((g) => filters.hiddenConnectors.has(g))) {
      return false;
    }
  }
  return true;
}

export function zoneOfCable(
  cable: GraphCable,
  portToDevice: Map<string, GraphDevice>,
  noZone: string,
): string {
  return portToDevice.get(cable.sourcePortId)?.ownerRole?.trim() || noZone;
}

export default function CableCanvasFilters({
  cables,
  devices,
  category,
  hiddenConnectors,
  hiddenZones,
  onCategoryChange,
  onToggleConnector,
  onToggleZone,
}: {
  cables: GraphCable[];
  devices: GraphDevice[];
  category: CableCategory;
  hiddenConnectors: Set<string>;
  hiddenZones: Set<string>;
  onCategoryChange: (c: CableCategory) => void;
  onToggleConnector: (connector: string) => void;
  onToggleZone: (zone: string) => void;
}) {
  const { t } = useI18n();
  const noZone = t('cables.noZone');

  const portToDevice = useMemo(() => {
    const map = new Map<string, GraphDevice>();
    for (const d of devices) for (const p of d.ports) map.set(p.id, d);
    return map;
  }, [devices]);

  const portById = useMemo(() => {
    const map = new Map<string, { portType: string }>();
    for (const d of devices) for (const p of d.ports) map.set(p.id, p);
    return map;
  }, [devices]);

  const allZones = useMemo(() => {
    const zones = new Set<string>();
    for (const c of cables) zones.add(zoneOfCable(c, portToDevice, noZone));
    return Array.from(zones).sort();
  }, [cables, portToDevice, noZone]);

  /** Only connector groups that actually appear on current cables (in category). */
  const presentConnectors = useMemo(() => {
    const present = new Set<ConnectorFilterId>();
    for (const c of cables) {
      if (category === 'audio' && !AUDIO_TYPES.has(c.cableType)) continue;
      if (category === 'power' && !POWER_TYPES.has(c.cableType)) continue;
      for (const g of connectorGroupsForCable(c, portById)) present.add(g);
    }
    return CONNECTOR_ORDER.filter((id) => present.has(id));
  }, [cables, portById, category]);

  return (
    <div className="pointer-events-auto flex max-w-[min(920px,calc(100vw-8rem))] flex-wrap items-center gap-2 rounded-xl border border-default-200 bg-surface/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md">
      <div className="flex items-center rounded-lg border border-default-200 bg-surface-secondary/80 p-0.5">
        {(
          [
            ['all', t('cables.viewAll')],
            ['audio', t('cables.viewAudio')],
            ['power', t('cables.viewPower')],
          ] as [CableCategory, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onCategoryChange(key)}
            className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-all ${
              category === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-default-500 hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {presentConnectors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] font-medium uppercase tracking-wide text-default-500">
            {t('cables.filterConnector')}
          </span>
          {presentConnectors.map((id) => {
            const active = !hiddenConnectors.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onToggleConnector(id)}
                title={t(CONNECTOR_LABEL_KEY[id])}
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-opacity ${
                  active ? 'border-default-200 opacity-100' : 'border-default-200 opacity-35'
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full border border-white/20"
                  style={{ backgroundColor: CONNECTOR_DOT[id] }}
                />
                <PortTypeIcon portType={CONNECTOR_ICON_PORT[id]} className="h-2.5 w-2.5" />
                {t(CONNECTOR_LABEL_KEY[id])}
              </button>
            );
          })}
        </div>
      )}

      {allZones.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] font-medium uppercase tracking-wide text-default-500">
            {t('cables.filterZone')}
          </span>
          {allZones.map((z) => {
            const active = !hiddenZones.has(z);
            return (
              <label
                key={z}
                className={`flex cursor-pointer items-center gap-1 rounded-full border border-default-200 px-1.5 py-0.5 text-[10px] transition-opacity ${
                  active ? 'opacity-100' : 'opacity-35'
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggleZone(z)}
                  className="h-2.5 w-2.5"
                />
                {z === noZone ? noZone : formatOwnerRole(z, t)}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
