import { type CableType, DeviceType } from '@resopatch/shared';
import { cableTypeLabel } from './cableTypeLabel';
import { deviceTypeKey } from './deviceNaming';
import type { Language, TranslationKey } from './i18n/dictionaries';
import { formatI18nText } from './i18nText';

type TFn = (key: TranslationKey) => string;

/** Literal keys — avoid depending on enum object identity at module init. */
const PORT_TYPE_KEY: Record<string, TranslationKey> = {
  XLR_M: 'portType.XLR_M',
  XLR_F: 'portType.XLR_F',
  TRS_14: 'portType.TRS_14',
  TRS_18: 'portType.TRS_18',
  TRRS_18: 'portType.TRRS_18',
  TS_14: 'portType.TS_14',
  COMBO_XLR_TRS: 'portType.COMBO_XLR_TRS',
  MIDI_DIN: 'portType.MIDI_DIN',
  USB_C: 'portType.USB_C',
  USB_A: 'portType.USB_A',
  USB_B: 'portType.USB_B',
  DC_BARREL: 'portType.DC_BARREL',
  POWER_IEC: 'portType.POWER_IEC',
  POWER_SCHUKO: 'portType.POWER_SCHUKO',
  WIRELESS: 'portType.WIRELESS',
};

const PORT_DIRECTION_KEY: Record<string, TranslationKey> = {
  IN: 'portDirection.IN',
  OUT: 'portDirection.OUT',
  BI: 'portDirection.BI',
};

const POWER_SOURCE_KEY: Record<string, TranslationKey> = {
  USB_C_PD: 'powerSource.USB_C_PD',
  USB_BUS: 'powerSource.USB_BUS',
  AC_MAINS: 'powerSource.AC_MAINS',
  DC_BARREL: 'powerSource.DC_BARREL',
  BATTERY: 'powerSource.BATTERY',
  PASSIVE_NONE: 'powerSource.PASSIVE_NONE',
  NONE: 'powerSource.NONE',
};

const HOST_USB_KEY: Record<string, TranslationKey> = {
  USB_C: 'hostUsb.USB_C',
  USB_A: 'hostUsb.USB_A',
  USB_B: 'hostUsb.USB_B',
  NONE: 'hostUsb.NONE',
};

const POLARITY_KEY: Record<string, TranslationKey> = {
  CENTER_POSITIVE: 'polarity.centerPositive',
  CENTER_NEGATIVE: 'polarity.centerNegative',
  ANY: 'polarity.any',
  NA: 'polarity.na',
};

const INVENTORY_STATUS_KEY: Record<string, TranslationKey> = {
  OWNED_ACTIVE: 'status.ownedActive',
  OWNED_INACTIVE: 'status.ownedInactive',
  PLANNED_NOT_OWNED: 'status.planned',
  VENUE_PROVIDED: 'status.venueProvided',
};

const CURRENT_TYPE_KEY: Record<string, TranslationKey> = {
  AC: 'currentType.AC',
  DC: 'currentType.DC',
};

const CABLE_TYPE_KEY: Record<string, TranslationKey> = {
  AUDIO_BALANCED: 'cableType.audioBalanced',
  AUDIO_UNBALANCED: 'cableType.audioUnbalanced',
  MIDI: 'cableType.midi',
  USB_DATA: 'cableType.usbData',
  POWER_LINE: 'cableType.powerLine',
  CONTROL_LINK: 'cableType.controlLink',
};

const FURNITURE_KIND_KEY: Record<string, TranslationKey> = {
  LAPTOP_STAND: 'furnitureKind.LAPTOP_STAND',
  TABLE: 'furnitureKind.TABLE',
  CHAIR: 'furnitureKind.CHAIR',
  GUITAR_STAND: 'furnitureKind.GUITAR_STAND',
  KEYBOARD_STAND: 'furnitureKind.KEYBOARD_STAND',
  MIC_STAND: 'furnitureKind.MIC_STAND',
  PEDALBOARD_CASE: 'furnitureKind.PEDALBOARD_CASE',
};

function resolveEnumLabel(
  value: string | null | undefined,
  map: Record<string, TranslationKey>,
  t: TFn,
): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const key = map[raw] ?? map[raw.toUpperCase()];
  if (key) {
    const label = t(key);
    // If dictionary misses the key, `t` returns the key path — don't show that.
    if (label && label !== key) return label;
  }
  return raw;
}

export function portTypeLabel(portType: string, t: TFn): string {
  return resolveEnumLabel(portType, PORT_TYPE_KEY, t);
}

export function portDirectionLabel(direction: string, t: TFn): string {
  return resolveEnumLabel(direction, PORT_DIRECTION_KEY, t);
}

export function powerSourceLabel(value: string, t: TFn): string {
  return resolveEnumLabel(value, POWER_SOURCE_KEY, t);
}

export function cableTypeEnumLabel(value: string, t: TFn): string {
  return resolveEnumLabel(value, CABLE_TYPE_KEY, t);
}

export function furnitureKindLabel(value: string, t: TFn): string {
  return resolveEnumLabel(value, FURNITURE_KIND_KEY, t);
}

/**
 * Rider row `name` is often a raw enum or a string with enums embedded
 * (e.g. `AUDIO_BALANCED (3m)`, `Device power (AC_MAINS)`).
 */
export function formatRiderRowName(category: string, name: string, t: TFn, lang: Language): string {
  const raw = name ?? '';
  if (category === 'FURNITURE') {
    return furnitureKindLabel(raw, t);
  }
  if (category === 'CABLE') {
    // "AUDIO_BALANCED (3m)" from API
    const m = /^([A-Z_]+)\s*\((.+)\)$/.exec(raw.trim());
    if (m) {
      const typeLabel = cableTypeEnumLabel(m[1], t);
      return `${typeLabel} (${m[2]})`;
    }
    return cableTypeEnumLabel(raw, t) || raw;
  }
  if (category === 'POWER') {
    // "{device} power ({PowerSourceType})" — localize the trailing enum if present
    const m = /^(.*?)\s+power\s*\(([^)]+)\)\s*$/i.exec(raw.trim());
    if (m) {
      const device = formatI18nText(m[1], lang);
      const src = powerSourceLabel(m[2].trim(), t);
      return t('constructor.rider.powerNeed').replace('{device}', device).replace('{source}', src);
    }
    return formatI18nText(raw, lang);
  }
  // EQUIPMENT / ADAPTER — free-form or bilingual names
  return formatI18nText(raw, lang);
}

export function hostUsbLabel(value: string, t: TFn): string {
  return resolveEnumLabel(value, HOST_USB_KEY, t);
}

export function polarityLabel(value: string, t: TFn): string {
  return resolveEnumLabel(value, POLARITY_KEY, t);
}

export function inventoryStatusLabel(value: string, t: TFn): string {
  return resolveEnumLabel(value, INVENTORY_STATUS_KEY, t);
}

export function currentTypeLabel(value: string, t: TFn): string {
  return resolveEnumLabel(value, CURRENT_TYPE_KEY, t);
}

export function deviceTypeLabel(type: DeviceType | string, t: TFn): string {
  return t(deviceTypeKey(type as DeviceType));
}

export { cableTypeLabel };

/** Build a map of enum value → localized label for Select items. */
export function labeledEnumOptions<T extends string>(
  values: readonly T[],
  labelOf: (value: T) => string,
): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labelOf(value) }));
}

// Re-export CableType for callers that want a single import site for cable labels.
export type { CableType };
