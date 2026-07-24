import { CableType } from './enums.js';
// race-test probe

/** Apple HIG dark-mode system colors, mapped to signal types for the patch map. */
export const CABLE_COLORS: Record<CableType, string> = {
  AUDIO_BALANCED: '#0A84FF', // systemBlue
  AUDIO_UNBALANCED: '#64D2FF', // systemTeal
  MIDI: '#FF9F0A', // systemOrange
  USB_DATA: '#30D158', // systemGreen — USB is Green!
  POWER_LINE: '#AF52DE', // systemPurple — Default Power / 9V is Purple!
  CONTROL_LINK: '#FFD60A', // systemYellow — dashed wireless link
};

export const ADAPTER_BADGE_COLOR = '#FF375F'; // systemPink
export const NEUTRAL_EDGE_COLOR = '#8E8E93'; // systemGray

/** SVG `stroke-dasharray` per cable medium. `undefined` means solid. */
export const CABLE_DASH: Record<CableType, string | undefined> = {
  AUDIO_BALANCED: undefined, // solid
  AUDIO_UNBALANCED: '2 3', // fine dots
  MIDI: '1 4', // sparse dots
  USB_DATA: '9 3 2 3', // dash-dot
  POWER_LINE: undefined, // solid
  CONTROL_LINK: '6 4', // dashed
};

/** Relative stroke-width multiplier per cable medium. */
export const CABLE_WIDTH_SCALE: Record<CableType, number> = {
  AUDIO_BALANCED: 1,
  AUDIO_UNBALANCED: 1,
  MIDI: 1,
  USB_DATA: 1,
  POWER_LINE: 1.6,
  CONTROL_LINK: 1,
};

/** Dynamic visual styling for power cables based on voltage rating (120V AC mains, 18V, 12V, 9V, 5V),
 *  connector port type, and AC vs DC current type.
 *  - USB-C PD (any negotiated voltage): System Indigo (#5E5CE6) — called out on its own regardless
 *    of voltage tier, since PD negotiates a range (5/9/15/20V) and the connector identity matters
 *    more than the momentary voltage.
 *  - 120V AC Mains / Power Strips / Schuko / IEC: High Voltage Red (#FF3B30)
 *  - 18V: Dark Purple (#9B51E0)
 *  - 12V: System Yellow (#FFD60A)
 *  - 9V: System Purple (#AF52DE)
 *  - 5V: System Cyan (#64D2FF)
 */
export function getPowerCableStyle(
  voltageV?: number | null,
  currentType?: string | null,
  portType?: string | null,
  deviceType?: string | null,
): { stroke: string; widthScale: number; dash?: string } {
  if (portType === 'USB_C') {
    // USB-C PD — Indigo
    return { stroke: '#5E5CE6', widthScale: 1.4 };
  }

  const isMains = portType === 'POWER_SCHUKO' || portType === 'POWER_IEC' || deviceType === 'POWER_STRIP';

  const effectiveVoltage = voltageV ?? (isMains ? 120 : 9);
  const effectiveCurrent = currentType ?? (isMains ? 'AC' : 'DC');
  const isAC = effectiveCurrent === 'AC';

  if (effectiveVoltage >= 100) {
    // 120V AC Mains Power (Удлинители, Schuko, IEC, розетки) — High Voltage Red
    return {
      stroke: '#FF3B30', // systemRed
      widthScale: 2.2,
      dash: isAC ? '8 2' : undefined,
    };
  }
  if (effectiveVoltage >= 18) {
    // 18V Power — Dark Purple
    return {
      stroke: '#9B51E0',
      widthScale: 1.6,
      dash: isAC ? '6 3' : undefined,
    };
  }
  if (effectiveVoltage >= 12) {
    // 12V Power — System Yellow
    return {
      stroke: '#FFD60A', // systemYellow
      widthScale: 1.6,
      dash: isAC ? '6 3' : undefined,
    };
  }
  if (effectiveVoltage <= 5) {
    // 5V Power / USB Power — System Cyan
    return {
      stroke: '#64D2FF', // systemCyan
      widthScale: 1.4,
      dash: isAC ? '6 3' : undefined,
    };
  }

  // 9V Pedalboard Power — System Purple
  return {
    stroke: '#AF52DE', // systemPurple
    widthScale: 1.6,
    dash: isAC ? '6 3' : undefined,
  };
}
