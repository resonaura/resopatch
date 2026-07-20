import { CableType } from './enums';

/** Apple HIG dark-mode system colors, mapped to signal types for the patch map. */
export const CABLE_COLORS: Record<CableType, string> = {
  AUDIO_BALANCED: '#0A84FF', // systemBlue
  AUDIO_UNBALANCED: '#64D2FF', // systemTeal
  MIDI: '#BF5AF2', // systemPurple
  USB_DATA: '#30D158', // systemGreen
  POWER_LINE: '#FF9F0A', // systemOrange
  CONTROL_LINK: '#FFD60A', // systemYellow — dashed wireless link, not a physical cable
};

export const ADAPTER_BADGE_COLOR = '#FF375F'; // systemPink
export const NEUTRAL_EDGE_COLOR = '#8E8E93'; // systemGray
