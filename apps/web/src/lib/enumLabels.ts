import {
    CableType,
    CurrentType,
    DeviceType,
    HostUsbType,
    InventoryStatus,
    Polarity,
    PortDirection,
    PortType,
    PowerSourceType,
} from '@resopatch/shared';
import { cableTypeLabel } from './cableTypeLabel';
import { deviceTypeKey } from './deviceNaming';
import type { TranslationKey } from './i18n/dictionaries';

type TFn = (key: TranslationKey) => string;

const PORT_TYPE_KEY: Record<string, TranslationKey> = {
  [PortType.XLR_M]: 'portType.XLR_M',
  [PortType.XLR_F]: 'portType.XLR_F',
  [PortType.TRS_14]: 'portType.TRS_14',
  [PortType.TRS_18]: 'portType.TRS_18',
  [PortType.TRRS_18]: 'portType.TRRS_18',
  [PortType.TS_14]: 'portType.TS_14',
  [PortType.COMBO_XLR_TRS]: 'portType.COMBO_XLR_TRS',
  [PortType.MIDI_DIN]: 'portType.MIDI_DIN',
  [PortType.USB_C]: 'portType.USB_C',
  [PortType.USB_A]: 'portType.USB_A',
  [PortType.USB_B]: 'portType.USB_B',
  [PortType.DC_BARREL]: 'portType.DC_BARREL',
  [PortType.POWER_IEC]: 'portType.POWER_IEC',
  [PortType.POWER_SCHUKO]: 'portType.POWER_SCHUKO',
  [PortType.WIRELESS]: 'portType.WIRELESS',
};

const PORT_DIRECTION_KEY: Record<string, TranslationKey> = {
  [PortDirection.IN]: 'portDirection.IN',
  [PortDirection.OUT]: 'portDirection.OUT',
  [PortDirection.BI]: 'portDirection.BI',
};

const POWER_SOURCE_KEY: Record<string, TranslationKey> = {
  [PowerSourceType.USB_C_PD]: 'powerSource.USB_C_PD',
  [PowerSourceType.USB_BUS]: 'powerSource.USB_BUS',
  [PowerSourceType.AC_MAINS]: 'powerSource.AC_MAINS',
  [PowerSourceType.DC_BARREL]: 'powerSource.DC_BARREL',
  [PowerSourceType.BATTERY]: 'powerSource.BATTERY',
  [PowerSourceType.PASSIVE_NONE]: 'powerSource.PASSIVE_NONE',
  [PowerSourceType.NONE]: 'powerSource.NONE',
};

const HOST_USB_KEY: Record<string, TranslationKey> = {
  [HostUsbType.USB_C]: 'hostUsb.USB_C',
  [HostUsbType.USB_A]: 'hostUsb.USB_A',
  [HostUsbType.USB_B]: 'hostUsb.USB_B',
  [HostUsbType.NONE]: 'hostUsb.NONE',
};

const POLARITY_KEY: Record<string, TranslationKey> = {
  [Polarity.CENTER_POSITIVE]: 'polarity.centerPositive',
  [Polarity.CENTER_NEGATIVE]: 'polarity.centerNegative',
  [Polarity.ANY]: 'polarity.any',
  [Polarity.NA]: 'polarity.na',
};

const INVENTORY_STATUS_KEY: Record<string, TranslationKey> = {
  [InventoryStatus.OWNED_ACTIVE]: 'status.ownedActive',
  [InventoryStatus.OWNED_INACTIVE]: 'status.ownedInactive',
  [InventoryStatus.PLANNED_NOT_OWNED]: 'status.planned',
  [InventoryStatus.VENUE_PROVIDED]: 'status.venueProvided',
};

const CURRENT_TYPE_KEY: Record<string, TranslationKey> = {
  [CurrentType.AC]: 'currentType.AC',
  [CurrentType.DC]: 'currentType.DC',
};

export function portTypeLabel(portType: string, t: TFn): string {
  const key = PORT_TYPE_KEY[portType];
  return key ? t(key) : portType;
}

export function portDirectionLabel(direction: string, t: TFn): string {
  const key = PORT_DIRECTION_KEY[direction];
  return key ? t(key) : direction;
}

export function powerSourceLabel(value: string, t: TFn): string {
  const key = POWER_SOURCE_KEY[value];
  return key ? t(key) : value;
}

export function hostUsbLabel(value: string, t: TFn): string {
  const key = HOST_USB_KEY[value];
  return key ? t(key) : value;
}

export function polarityLabel(value: string, t: TFn): string {
  const key = POLARITY_KEY[value];
  return key ? t(key) : value;
}

export function inventoryStatusLabel(value: string, t: TFn): string {
  const key = INVENTORY_STATUS_KEY[value];
  return key ? t(key) : value;
}

export function currentTypeLabel(value: string, t: TFn): string {
  const key = CURRENT_TYPE_KEY[value];
  return key ? t(key) : value;
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
