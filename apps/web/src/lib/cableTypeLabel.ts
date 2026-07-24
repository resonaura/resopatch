import { CableType } from '@resopatch/shared';
import type { TranslationKey } from './i18n/dictionaries';

const CABLE_TYPE_LABEL_KEY: Record<string, TranslationKey> = {
  [CableType.AUDIO_BALANCED]: 'cableType.audioBalanced',
  [CableType.AUDIO_UNBALANCED]: 'cableType.audioUnbalanced',
  [CableType.MIDI]: 'cableType.midi',
  [CableType.USB_DATA]: 'cableType.usbData',
  [CableType.POWER_LINE]: 'cableType.powerLine',
  [CableType.CONTROL_LINK]: 'cableType.controlLink',
};

export function cableTypeLabel(cableType: string, t: (key: TranslationKey) => string): string {
  const key = CABLE_TYPE_LABEL_KEY[cableType];
  return key ? t(key) : cableType;
}
