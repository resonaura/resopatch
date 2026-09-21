import type { LayoutCable, LayoutDevice } from './types';

/** Creates a position-independent fingerprint of the graph structure. */
export function graphTopologyKey(devices: LayoutDevice[], cables: LayoutCable[]): string {
  const deviceKey = devices
    .map(
      (device) =>
        `${device.id}:${device.parentDeviceId ?? ''}:${device.ownerRole ?? ''}:${device.type}:${device.inventoryStatus}`,
    )
    .sort()
    .join('|');
  const cableKey = cables
    .map((cable) => `${cable.sourcePortId}->${cable.targetPortId}`)
    .sort()
    .join('|');
  return `${deviceKey}#${cableKey}`;
}
