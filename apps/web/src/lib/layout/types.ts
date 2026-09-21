import type { DeviceType, InventoryStatus } from '@resopatch/shared';

export interface LayoutDevice {
  id: string;
  name: string;
  type: DeviceType;
  inventoryStatus: InventoryStatus;
  ownerRole: string | null;
  parentDeviceId: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  ports: { id: string }[];
}

export interface LayoutCable {
  sourcePortId: string;
  targetPortId: string;
  /** Used to keep power-chain ranks separate from signal-flow ranks. */
  cableType?: string;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

export type LogicalFamily = 'guitar' | 'vocal' | 'keys' | 'laptop' | 'io' | 'power' | 'other';
export type ZoneName = 'andrii' | 'drummer' | 'vox' | 'service' | 'inactive';
