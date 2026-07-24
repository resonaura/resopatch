import { DeviceType } from '@resopatch/shared';

/** Type-based fallback label shown when a device has no name and no manufacturer/model in
 *  attrs — i.e. a "generic" item (strap, USB cable, velcro…). Kept as a plain dictionary for
 *  now; these strings move into the i18n dictionary files once that migration lands. */
const GENERIC_TYPE_LABEL: Partial<Record<DeviceType, string>> = {
  [DeviceType.ACCESSORY]: 'Аксессуар',
  [DeviceType.INSTRUMENT]: 'Инструмент',
  [DeviceType.PEDAL]: 'Педаль',
};

/** Never invents a brand/model — falls back to manufacturer+model from attrs, then to a
 *  type-based generic label, only when `name` itself is blank. */
export function getDisplayName(device: { name: string; type: DeviceType; attrs: Record<string, unknown> }): string {
  if (device.name.trim()) return device.name;
  const manufacturer = typeof device.attrs.manufacturer === 'string' ? device.attrs.manufacturer : undefined;
  const model = typeof device.attrs.model === 'string' ? device.attrs.model : undefined;
  if (manufacturer || model) return [manufacturer, model].filter(Boolean).join(' ');
  return GENERIC_TYPE_LABEL[device.type] ?? device.type;
}
