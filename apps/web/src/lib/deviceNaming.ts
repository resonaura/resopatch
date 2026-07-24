import { DeviceType } from '@resopatch/shared';
import type { Language, TranslationKey } from './i18n/dictionaries';
import { formatI18nText } from './i18nText';

/** Returns the `deviceType.*` translation key for any DeviceType value. */
export function deviceTypeKey(type: DeviceType): TranslationKey {
  return `deviceType.${type}` as TranslationKey;
}

/** Never invents a brand/model — falls back to manufacturer+model from attrs, then to a
 *  type-based generic label resolved from the i18n dictionary (see lib/i18n).
 *  `t` is the caller's `useI18n().t`, passed in explicitly since this is a plain function,
 *  not a hook. */
export function getDisplayName(
  device: { name: string; type: DeviceType; attrs: Record<string, unknown> },
  t: (key: TranslationKey) => string,
  lang: Language = 'en',
): string {
  if (device.name && device.name.trim()) return formatI18nText(device.name, lang);
  const manufacturer = typeof device.attrs.manufacturer === 'string' ? device.attrs.manufacturer : undefined;
  const model = typeof device.attrs.model === 'string' ? device.attrs.model : undefined;
  if (manufacturer || model) return [manufacturer, model].filter(Boolean).join(' ');
  return t(deviceTypeKey(device.type));
}
