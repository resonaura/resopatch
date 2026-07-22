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

/** SVG `stroke-dasharray` per cable medium — color alone (CABLE_COLORS) doesn't hold up for
 *  colorblind readers or printed/greyscale copies of the patch map, and at a glance a dash pattern
 *  reads as "what kind of line is this" faster than matching a hue against a legend. `undefined`
 *  means solid. */
export const CABLE_DASH: Record<CableType, string | undefined> = {
  AUDIO_BALANCED: undefined, // solid — the default, most common medium
  AUDIO_UNBALANCED: '2 3', // fine dots
  MIDI: '1 4', // sparse dots
  USB_DATA: '9 3 2 3', // dash-dot
  POWER_LINE: undefined, // solid, distinguished by extra stroke width instead (see CABLE_WIDTH)
  CONTROL_LINK: '6 4', // dashed — also the only medium that isn't a physical cable
};

/** Relative stroke-width multiplier per cable medium (applied on top of the selection-state base
 *  width) — power runs read as visibly heavier-gauge than signal cables, matching how they look
 *  in a real pile of cables underfoot. */
export const CABLE_WIDTH_SCALE: Record<CableType, number> = {
  AUDIO_BALANCED: 1,
  AUDIO_UNBALANCED: 1,
  MIDI: 1,
  USB_DATA: 1,
  POWER_LINE: 1.6,
  CONTROL_LINK: 1,
};
