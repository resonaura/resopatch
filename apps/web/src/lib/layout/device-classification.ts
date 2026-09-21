import { DeviceType } from '@resopatch/shared';
import type { LayoutDevice, LogicalFamily } from './types';

export const FAMILY_ORDER: LogicalFamily[] = [
  'guitar',
  'vocal',
  'keys',
  'laptop',
  'io',
  'other',
  'power',
];

export function deviceNameIncludes(device: LayoutDevice, value: string): boolean {
  const normalizedValue = value.toLowerCase();
  try {
    const localizedNames = JSON.parse(device.name ?? '') as Record<string, string>;
    return Object.values(localizedNames).some((name) =>
      name.toLowerCase().includes(normalizedValue),
    );
  } catch {
    return (device.name ?? '').toLowerCase().includes(normalizedValue);
  }
}

/** Flattens localized names into one lower-case string for classification. */
export function deviceNameLower(device: LayoutDevice): string {
  try {
    const localizedNames = JSON.parse(device.name ?? '') as Record<string, string>;
    return Object.values(localizedNames).join(' ').toLowerCase();
  } catch {
    return (device.name ?? '').toLowerCase();
  }
}

export function isPowerInfrastructure(device: LayoutDevice): boolean {
  return (
    device.type === DeviceType.POWER_SUPPLY ||
    device.type === DeviceType.POWER_SPLITTER ||
    device.type === DeviceType.POWER_STRIP
  );
}

/** Classifies a device into a signal family used for within-zone packing. */
export function logicalFamily(device: LayoutDevice): LogicalFamily {
  if (isPowerInfrastructure(device)) return 'power';

  const name = deviceNameLower(device);
  const type = device.type;
  const guitarTypes: DeviceType[] = [DeviceType.PEDALBOARD, DeviceType.PEDAL, DeviceType.AMPLIFIER];
  if (guitarTypes.includes(type)) {
    return 'guitar';
  }
  if (type === DeviceType.INSTRUMENT) return 'guitar';
  if (
    type === DeviceType.MICROPHONE &&
    ['combo', 'e835', 'cab mic', 'amp mic'].some((token) => name.includes(token))
  ) {
    return 'guitar';
  }
  if (type === DeviceType.VOCAL_PROCESSOR || type === DeviceType.MICROPHONE) return 'vocal';
  if (
    type === DeviceType.MONITOR &&
    ['iem', 'earphone', 'in-ear'].some((token) => name.includes(token))
  ) {
    return 'vocal';
  }
  if (
    type === DeviceType.AUDIO_INTERFACE &&
    ['volt', 'vocal'].some((token) => name.includes(token))
  ) {
    return 'vocal';
  }
  if (type === DeviceType.KEYBOARD || type === DeviceType.MIDI_DEVICE) return 'keys';
  if (
    type === DeviceType.LAPTOP &&
    ['synth', 'keys', 'клав'].some((token) => name.includes(token))
  ) {
    return 'keys';
  }
  if (type === DeviceType.LAPTOP) return 'laptop';
  if (
    (
      [
        DeviceType.STAGE_BOX,
        DeviceType.AUDIO_INTERFACE,
        DeviceType.MIXER,
        DeviceType.MONITOR_CONTROLLER,
        DeviceType.MONITOR,
      ] as DeviceType[]
    ).includes(type) ||
    ['motu', 'stage box', 'стейдж', 'stagebox'].some((token) => name.includes(token))
  ) {
    return 'io';
  }
  return 'other';
}
