import { DeviceType, InventoryStatus } from '@resopatch/shared';
import type { LayoutDevice, ZoneName } from './types';

/** Normalizes free-text Russian, English, and slug owner roles into layout zones. */
export function normalizeOwnerZone(ownerRole: string | null | undefined): ZoneName | null {
  if (!ownerRole) return null;

  const role = ownerRole.trim().toLowerCase().replace(/\s+/g, ' ');
  if (['andrii', 'андрей', 'andrey', 'андрій'].includes(role)) return 'andrii';
  if (['danvox', 'dan-vox', 'dan', 'даня-вокал', 'даня вокал', 'даня', 'vox'].includes(role)) {
    return 'vox';
  }
  if (
    [
      'dandrummer',
      'dan-drummer',
      'dan drummer',
      'даня-барабанщик',
      'даня барабанщик',
      'drummer',
    ].includes(role)
  ) {
    return 'drummer';
  }
  return null;
}

export function zoneOf(device: LayoutDevice): ZoneName {
  if (
    device.inventoryStatus === InventoryStatus.OWNED_INACTIVE ||
    device.inventoryStatus === InventoryStatus.PLANNED_NOT_OWNED
  ) {
    return 'inactive';
  }

  const ownerZone = normalizeOwnerZone(device.ownerRole);
  if (ownerZone) return ownerZone;
  if (device.type === DeviceType.STAGE_BOX) return 'service';
  return 'service';
}
