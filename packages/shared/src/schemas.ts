import { z } from 'zod';
import {
  CableType,
  CurrentType,
  DeviceType,
  FurnitureKind,
  HostUsbType,
  InventoryStatus,
  Polarity,
  PortDirection,
  PortType,
  PowerSourceType,
  SignalFormat,
} from './enums.js';

// Preserves the literal union (e.g. DeviceType) through z.enum(), instead of widening to `string` —
// otherwise every DTO field typed from one of these enums would lose its literal type everywhere.
const enumValues = <T extends Record<string, string>>(e: T) => Object.values(e) as [T[keyof T], ...T[keyof T][]];

export const positionSchema = z.object({ x: z.number(), y: z.number() });

export const powerProfileSchema = z.object({
  currentType: z.enum(enumValues(CurrentType)).optional(),
  voltageV: z.number().optional(),
  currentMA: z.number().optional(),
  polarity: z.enum(enumValues(Polarity)).optional(),
  maxOutputCurrentMA: z.number().optional(),
  maxOutputPowerW: z.number().optional(),
});
export type PowerProfileDto = z.infer<typeof powerProfileSchema>;

export const pedalProfileSchema = z.object({
  isStereoIn: z.boolean().optional(),
  isStereoOut: z.boolean().optional(),
  hasPresets: z.boolean().optional(),
  presetCount: z.number().int().nonnegative().optional(),
  hasMidiControl: z.boolean().optional(),
  smartModes: z.array(z.string()).optional(),
});
export type PedalProfileDto = z.infer<typeof pedalProfileSchema>;

export const createSetupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type CreateSetupDto = z.infer<typeof createSetupSchema>;
export const updateSetupSchema = createSetupSchema.partial();
export type UpdateSetupDto = z.infer<typeof updateSetupSchema>;

export const createDeviceSchema = z.object({
  setupId: z.string(),
  name: z.string().min(1),
  type: z.enum(enumValues(DeviceType)),
  inventoryStatus: z.enum(enumValues(InventoryStatus)).default(InventoryStatus.OWNED_ACTIVE),
  powerRequired: z.boolean().default(false),
  powerSourceType: z.enum(enumValues(PowerSourceType)).default(PowerSourceType.NONE),
  hostUsbType: z.enum(enumValues(HostUsbType)).default(HostUsbType.NONE),
  ownerRole: z.string().optional(),
  parentDeviceId: z.string().optional(),
  position: positionSchema.default({ x: 0, y: 0 }),
  power: powerProfileSchema.default({}),
  pedal: pedalProfileSchema.optional(),
  imageUrl: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  notes: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).default({}),
});
export type CreateDeviceDto = z.infer<typeof createDeviceSchema>;
export const updateDeviceSchema = createDeviceSchema.partial().omit({ setupId: true });
export type UpdateDeviceDto = z.infer<typeof updateDeviceSchema>;

export const createPortSchema = z.object({
  deviceId: z.string(),
  name: z.string().min(1),
  portType: z.enum(enumValues(PortType)),
  direction: z.enum(enumValues(PortDirection)),
  signalFormat: z.enum(enumValues(SignalFormat)).optional(),
  power: powerProfileSchema.default({}),
});
export type CreatePortDto = z.infer<typeof createPortSchema>;
export const updatePortSchema = createPortSchema.partial().omit({ deviceId: true });
export type UpdatePortDto = z.infer<typeof updatePortSchema>;

export const createAdapterSchema = z.object({
  name: z.string().min(1),
  inputType: z.enum(enumValues(PortType)),
  outputType: z.enum(enumValues(PortType)),
  isActive: z.boolean().default(false),
  invertsPolarity: z.boolean().default(false),
});
export type CreateAdapterDto = z.infer<typeof createAdapterSchema>;
export const updateAdapterSchema = createAdapterSchema.partial();
export type UpdateAdapterDto = z.infer<typeof updateAdapterSchema>;

export const createCableSchema = z.object({
  sourcePortId: z.string(),
  targetPortId: z.string(),
  cableType: z.enum(enumValues(CableType)),
  length: z.number().positive(),
  adapterId: z.string().optional(),
  isUserOwned: z.boolean().default(true),
  color: z.string().optional(),
  productName: z.string().nullable().optional(),
  isPatchCable: z.boolean().default(false),
  imageUrl: z.string().nullable().optional(),
  textureStartUrl: z.string().nullable().optional(),
  textureEndUrl: z.string().nullable().optional(),
  textureMiddleUrl: z.string().nullable().optional(),
});
export type CreateCableDto = z.infer<typeof createCableSchema>;
export const updateCableSchema = createCableSchema.partial();
export type UpdateCableDto = z.infer<typeof updateCableSchema>;

export const createFurnitureSchema = z.object({
  deviceId: z.string(),
  kind: z.enum(enumValues(FurnitureKind)),
  isVenueProvided: z.boolean().default(false),
});
export type CreateFurnitureDto = z.infer<typeof createFurnitureSchema>;
export const updateFurnitureSchema = createFurnitureSchema.partial().omit({ deviceId: true });
export type UpdateFurnitureDto = z.infer<typeof updateFurnitureSchema>;

export const loginSchema = z.object({
  passphrase: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

/** Real rendered pixel size of each device's canvas node, as measured by the browser — the
 *  auto-layout algorithm packs devices using these instead of guessing dimensions server-side. */
export const autoLayoutSchema = z.object({
  sizes: z.record(z.string(), z.object({ width: z.number().positive(), height: z.number().positive() })).default({}),
});
export type AutoLayoutDto = z.infer<typeof autoLayoutSchema>;
