import {
  AudioLines,
  Box,
  Cable,
  Guitar,
  Headphones,
  Keyboard,
  Laptop,
  Layers,
  Lightbulb,
  Mic,
  Mic2,
  Package,
  PlugZap,
  Split,
  Speaker,
  SlidersHorizontal,
  Volume2,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { DeviceType } from '@resopatch/shared';

export const DEVICE_TYPE_ICONS: Record<string, LucideIcon> = {
  [DeviceType.LAPTOP]: Laptop,
  [DeviceType.AUDIO_INTERFACE]: AudioLines,
  [DeviceType.MIXER]: SlidersHorizontal,
  [DeviceType.MONITOR_CONTROLLER]: Volume2,
  [DeviceType.VOCAL_PROCESSOR]: Wand2,
  [DeviceType.MIDI_DEVICE]: Cable,
  [DeviceType.PEDAL]: Layers,
  [DeviceType.PEDALBOARD]: Layers,
  [DeviceType.POWER_SUPPLY]: Zap,
  [DeviceType.POWER_SPLITTER]: Split,
  [DeviceType.POWER_STRIP]: PlugZap,
  [DeviceType.STAGE_BOX]: Box,
  [DeviceType.MONITOR]: Headphones,
  [DeviceType.MICROPHONE]: Mic,
  [DeviceType.INSTRUMENT]: Guitar,
  [DeviceType.AMPLIFIER]: Speaker,
  [DeviceType.LIGHT]: Lightbulb,
  [DeviceType.KEYBOARD]: Keyboard,
  [DeviceType.ACCESSORY]: Package,
};

export function DeviceTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = DEVICE_TYPE_ICONS[type] ?? Mic2;
  return <Icon className={className ?? 'h-3.5 w-3.5'} strokeWidth={2} />;
}
