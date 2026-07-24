import { DeviceType } from '@resopatch/shared';
import type { TranslationKey } from './i18n/dictionaries';

/** Type-based fallback label key shown when a device has no name and no manufacturer/model in
 *  attrs — i.e. a "generic" item (strap, USB cable, velcro…). Resolved through the i18n
 *  dictionary (see lib/i18n) rather than a hardcoded string. */
const GENERIC_TYPE_LABEL_KEY: Partial<Record<DeviceType, TranslationKey>> = {
  [DeviceType.ACCESSORY]: 'generic.accessory',
  [DeviceType.INSTRUMENT]: 'generic.instrument',
  [DeviceType.PEDAL]: 'generic.pedal',
};

/** Never invents a brand/model — falls back to manufacturer+model from attrs, then to a
 *  type-based generic label, only when `name` itself is blank. `t` is the caller's `useI18n().t`,
 *  passed in explicitly since this is a plain function, not a hook. */
export function getDisplayName(
  device: { name: string; type: DeviceType; attrs: Record<string, unknown> },
  t: (key: TranslationKey) => string,
): string {
  if (device.name.trim()) return device.name;
  const manufacturer = typeof device.attrs.manufacturer === 'string' ? device.attrs.manufacturer : undefined;
  const model = typeof device.attrs.model === 'string' ? device.attrs.model : undefined;
  if (manufacturer || model) return [manufacturer, model].filter(Boolean).join(' ');
  const key = GENERIC_TYPE_LABEL_KEY[device.type];
  return key ? t(key) : device.type;
}
