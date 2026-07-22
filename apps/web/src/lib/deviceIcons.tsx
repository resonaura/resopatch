import { Icon } from '@iconify/react';
import { Guitar, Laptop, Lightbulb, Mic2, Package, type LucideIcon } from 'lucide-react';
import { DeviceType } from '@resopatch/shared';

/**
 * fontaudio (iconify prefix "fad") is a purpose-built audio-gear icon set — used wherever it has
 * a fitting glyph. It has no icons for a few device shapes (laptop, guitar, light, generic
 * accessory), so those fall back to lucide-react instead of forcing a bad semantic match.
 */
const FONTAUDIO_ICON: Partial<Record<string, string>> = {
  [DeviceType.AUDIO_INTERFACE]: 'fad:usb',
  [DeviceType.MIXER]: 'fad:slider-round-3',
  [DeviceType.MONITOR_CONTROLLER]: 'fad:slider-round-1',
  [DeviceType.VOCAL_PROCESSOR]: 'fad:modsine',
  [DeviceType.MIDI_DEVICE]: 'fad:midiplug',
  [DeviceType.PEDAL]: 'fad:roundswitch-on',
  [DeviceType.PEDALBOARD]: 'fad:drumpad',
  [DeviceType.POWER_SUPPLY]: 'fad:powerswitch',
  [DeviceType.POWER_SPLITTER]: 'fad:modularplug',
  [DeviceType.POWER_STRIP]: 'fad:thunderbolt',
  [DeviceType.STAGE_BOX]: 'fad:xlrplug',
  [DeviceType.MONITOR]: 'fad:headphones',
  [DeviceType.MICROPHONE]: 'fad:microphone',
  [DeviceType.AMPLIFIER]: 'fad:speaker',
  [DeviceType.KEYBOARD]: 'fad:keyboard',
};

const LUCIDE_ICON: Partial<Record<string, LucideIcon>> = {
  [DeviceType.LAPTOP]: Laptop,
  [DeviceType.INSTRUMENT]: Guitar,
  [DeviceType.LIGHT]: Lightbulb,
  [DeviceType.ACCESSORY]: Package,
};

export function DeviceTypeIcon({ type, className }: { type: string; className?: string }) {
  const fontaudioIcon = FONTAUDIO_ICON[type];
  if (fontaudioIcon) return <Icon icon={fontaudioIcon} className={className ?? 'h-3.5 w-3.5'} />;
  const LucideFallback = LUCIDE_ICON[type] ?? Mic2;
  return <LucideFallback className={className ?? 'h-3.5 w-3.5'} strokeWidth={2} />;
}
