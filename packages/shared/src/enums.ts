export const DeviceType = {
  LAPTOP: 'LAPTOP',
  AUDIO_INTERFACE: 'AUDIO_INTERFACE',
  MIXER: 'MIXER',
  MONITOR_CONTROLLER: 'MONITOR_CONTROLLER',
  VOCAL_PROCESSOR: 'VOCAL_PROCESSOR',
  MIDI_DEVICE: 'MIDI_DEVICE',
  PEDAL: 'PEDAL',
  PEDALBOARD: 'PEDALBOARD',
  POWER_SUPPLY: 'POWER_SUPPLY',
  POWER_SPLITTER: 'POWER_SPLITTER',
  POWER_STRIP: 'POWER_STRIP',
  STAGE_BOX: 'STAGE_BOX',
  MONITOR: 'MONITOR',
  MICROPHONE: 'MICROPHONE',
  INSTRUMENT: 'INSTRUMENT',
  AMPLIFIER: 'AMPLIFIER',
  LIGHT: 'LIGHT',
  KEYBOARD: 'KEYBOARD',
  ACCESSORY: 'ACCESSORY',
} as const;
export type DeviceType = (typeof DeviceType)[keyof typeof DeviceType];

/** How a device physically gets power — informational, not the electrical spec itself (see PowerProfile fields on Device/Port). */
export const PowerSourceType = {
  USB_C_PD: 'USB_C_PD',
  USB_BUS: 'USB_BUS',
  AC_MAINS: 'AC_MAINS',
  DC_BARREL: 'DC_BARREL',
  BATTERY: 'BATTERY',
  PASSIVE_NONE: 'PASSIVE_NONE',
  NONE: 'NONE',
} as const;
export type PowerSourceType = (typeof PowerSourceType)[keyof typeof PowerSourceType];

export const HostUsbType = {
  USB_C: 'USB_C',
  USB_A: 'USB_A',
  USB_B: 'USB_B',
  NONE: 'NONE',
} as const;
export type HostUsbType = (typeof HostUsbType)[keyof typeof HostUsbType];

export const PortType = {
  XLR_M: 'XLR_M',
  XLR_F: 'XLR_F',
  TRS_14: 'TRS_14',
  TRS_18: 'TRS_18',
  TRRS_18: 'TRRS_18',
  TS_14: 'TS_14',
  COMBO_XLR_TRS: 'COMBO_XLR_TRS',
  MIDI_DIN: 'MIDI_DIN',
  USB_C: 'USB_C',
  USB_A: 'USB_A',
  USB_B: 'USB_B',
  DC_BARREL: 'DC_BARREL',
  POWER_IEC: 'POWER_IEC',
  POWER_SCHUKO: 'POWER_SCHUKO',
  /** Virtual port used for non-cable command links (Wi-Fi/BLE/Matter — e.g. the Govee lamp). */
  WIRELESS: 'WIRELESS',
} as const;
export type PortType = (typeof PortType)[keyof typeof PortType];

export const PortDirection = {
  IN: 'IN',
  OUT: 'OUT',
  BI: 'BI',
} as const;
export type PortDirection = (typeof PortDirection)[keyof typeof PortDirection];

/** Informational only — the app never blocks a connection over a SignalFormat mismatch
 *  (e.g. plugging a stereo headphone-out into a mono mixer input is a normal, intentional thing to do). */
export const SignalFormat = {
  MIC_LEVEL: 'MIC_LEVEL',
  INSTRUMENT_LEVEL: 'INSTRUMENT_LEVEL',
  LINE_LEVEL_MONO_BALANCED: 'LINE_LEVEL_MONO_BALANCED',
  LINE_LEVEL_MONO_UNBALANCED: 'LINE_LEVEL_MONO_UNBALANCED',
  LINE_LEVEL_STEREO_UNBALANCED: 'LINE_LEVEL_STEREO_UNBALANCED',
} as const;
export type SignalFormat = (typeof SignalFormat)[keyof typeof SignalFormat];

export const CableType = {
  AUDIO_BALANCED: 'AUDIO_BALANCED',
  AUDIO_UNBALANCED: 'AUDIO_UNBALANCED',
  MIDI: 'MIDI',
  USB_DATA: 'USB_DATA',
  POWER_LINE: 'POWER_LINE',
  /** Wireless command link, not a physical cable (Wi-Fi/BLE/Matter) — still an edge in the graph. */
  CONTROL_LINK: 'CONTROL_LINK',
} as const;
export type CableType = (typeof CableType)[keyof typeof CableType];

export const CurrentType = {
  AC: 'AC',
  DC: 'DC',
} as const;
export type CurrentType = (typeof CurrentType)[keyof typeof CurrentType];

export const Polarity = {
  CENTER_POSITIVE: 'CENTER_POSITIVE',
  CENTER_NEGATIVE: 'CENTER_NEGATIVE',
  /** Device's power input is polarity-agnostic (e.g. MOTU UltraLite mk3 Hybrid). */
  ANY: 'ANY',
  /** Not applicable — AC power, USB power, battery, or no power port at all. */
  NA: 'NA',
} as const;
export type Polarity = (typeof Polarity)[keyof typeof Polarity];

/** Lifecycle state of an inventory item — deliberately NOT a boolean. An item can be real
 *  gear not currently patched in (MIDI Thru5 WC), gear that's only a plan (Дани-вокала's mixer),
 *  or something the venue is expected to supply. */
export const InventoryStatus = {
  OWNED_ACTIVE: 'OWNED_ACTIVE',
  OWNED_INACTIVE: 'OWNED_INACTIVE',
  PLANNED_NOT_OWNED: 'PLANNED_NOT_OWNED',
  VENUE_PROVIDED: 'VENUE_PROVIDED',
} as const;
export type InventoryStatus = (typeof InventoryStatus)[keyof typeof InventoryStatus];

export const FurnitureKind = {
  LAPTOP_STAND: 'LAPTOP_STAND',
  TABLE: 'TABLE',
  GUITAR_STAND: 'GUITAR_STAND',
  KEYBOARD_STAND: 'KEYBOARD_STAND',
  MIC_STAND: 'MIC_STAND',
  PEDALBOARD_CASE: 'PEDALBOARD_CASE',
} as const;
export type FurnitureKind = (typeof FurnitureKind)[keyof typeof FurnitureKind];

/** Connector family groups: which physical plug shapes mate without an adapter.
 *  Most port types belong to exactly one family; combo jacks (Volt 276 / UMC404HD inputs)
 *  legitimately accept two, so this is an array, not a 1:1 map. */
export const CONNECTOR_FAMILIES: Record<PortType, string[]> = {
  XLR_M: ['XLR'],
  XLR_F: ['XLR'],
  TRS_14: ['PHONE_14'],
  TS_14: ['PHONE_14'],
  TRS_18: ['PHONE_18'],
  TRRS_18: ['PHONE_18'],
  COMBO_XLR_TRS: ['XLR', 'PHONE_14'],
  MIDI_DIN: ['MIDI_DIN'],
  USB_C: ['USB_C'],
  USB_A: ['USB_A'],
  USB_B: ['USB_B'],
  DC_BARREL: ['DC_BARREL'],
  POWER_IEC: ['POWER_IEC'],
  POWER_SCHUKO: ['POWER_SCHUKO'],
  WIRELESS: ['WIRELESS'],
};

export const POWER_PORT_TYPES: PortType[] = [PortType.DC_BARREL, PortType.POWER_IEC, PortType.POWER_SCHUKO];

/** Port types each cable medium is allowed to terminate on. */
export const CABLE_MEDIUM_PORT_TYPES: Record<CableType, PortType[]> = {
  AUDIO_BALANCED: [PortType.XLR_M, PortType.XLR_F, PortType.TRS_14, PortType.COMBO_XLR_TRS],
  AUDIO_UNBALANCED: [PortType.TRS_14, PortType.TS_14, PortType.TRS_18, PortType.TRRS_18, PortType.COMBO_XLR_TRS],
  MIDI: [PortType.MIDI_DIN],
  USB_DATA: [PortType.USB_C, PortType.USB_A, PortType.USB_B],
  POWER_LINE: [PortType.DC_BARREL, PortType.POWER_IEC, PortType.POWER_SCHUKO],
  CONTROL_LINK: [PortType.WIRELESS],
};
