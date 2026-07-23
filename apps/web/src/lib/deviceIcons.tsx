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

function PedalboardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <rect x="4.5" y="9.5" width="4" height="5" rx="0.5" fill="currentColor" fillOpacity="0.25" />
      <rect x="10" y="9.5" width="4" height="5" rx="0.5" fill="currentColor" fillOpacity="0.25" />
      <rect x="15.5" y="9.5" width="4" height="5" rx="0.5" fill="currentColor" fillOpacity="0.25" />
      <circle cx="6.5" cy="8" r="0.75" fill="currentColor" />
      <circle cx="12" cy="8" r="0.75" fill="currentColor" />
      <circle cx="17.5" cy="8" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function DeviceTypeIcon({ type, className }: { type: string; className?: string }) {
  const combinedClass = `shrink-0 aspect-square inline-block ${className ?? 'h-3.5 w-3.5'}`;
  if (type === DeviceType.PEDALBOARD) return <PedalboardIcon className={combinedClass} />;
  const fontaudioIcon = FONTAUDIO_ICON[type];
  if (fontaudioIcon) return <Icon icon={fontaudioIcon} className={combinedClass} />;
  const LucideFallback = LUCIDE_ICON[type] ?? Mic2;
  return <LucideFallback className={combinedClass} strokeWidth={2} />;
}
