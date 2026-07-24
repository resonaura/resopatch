import {
  AdapterDto,
  CableDto,
  CreateAdapterDto,
  CreateCableDto,
  CreateDeviceDto,
  CreateFurnitureDto,
  CreatePortDto,
  DeviceDto,
  DeviceType,
  FurnitureDto,
  PortDto,
  SetupDto,
  UpdateAdapterDto,
  UpdateCableDto,
  UpdateDeviceDto,
  UpdateFurnitureDto,
  UpdatePortDto,
} from '@resopatch/shared';
import { Setup } from './entities/setup.entity.js';
import { Device } from './entities/device.entity.js';
import { Port } from './entities/port.entity.js';
import { Adapter } from './entities/adapter.entity.js';
import { Cable } from './entities/cable.entity.js';
import { Furniture } from './entities/furniture.entity.js';

export function toSetupDto(s: Setup): SetupDto {
  return { id: s.id, name: s.name, description: s.description, checklistState: s.checklistState ?? null };
}

export function toDeviceDto(d: Device): DeviceDto {
  return {
    id: d.id,
    setupId: d.setupId,
    name: d.name,
    type: d.type,
    inventoryStatus: d.inventoryStatus,
    powerRequired: d.powerRequired,
    powerSourceType: d.powerSourceType,
    hostUsbType: d.hostUsbType,
    ownerRole: d.ownerRole,
    parentDeviceId: d.parentDeviceId,
    position: { x: d.positionX, y: d.positionY },
    power: {
      currentType: d.powerCurrentType ?? undefined,
      voltageV: d.powerVoltageV ?? undefined,
      currentMA: d.powerCurrentMA ?? undefined,
      polarity: d.powerPolarity ?? undefined,
      maxOutputCurrentMA: d.powerMaxOutputCurrentMA ?? undefined,
      maxOutputPowerW: d.powerMaxOutputPowerW ?? undefined,
    },
    pedal:
      d.type === DeviceType.PEDAL
        ? {
            isStereoIn: d.pedalIsStereoIn ?? undefined,
            isStereoOut: d.pedalIsStereoOut ?? undefined,
            hasPresets: d.pedalHasPresets ?? undefined,
            presetCount: d.pedalPresetCount ?? undefined,
            hasMidiControl: d.pedalHasMidiControl ?? undefined,
            smartModes: d.pedalSmartModes ?? undefined,
          }
        : null,
    imageUrl: d.imageUrl,
    imageUrls: d.imageUrls ?? null,
    notes: d.notes,
    attrs: d.attrs ?? {},
  };
}

/** Mutates `entity` in place from a create/update DTO. Every field is applied only if present,
 *  so a partial UpdateDeviceDto never clobbers columns the caller didn't send. */
export function applyDeviceDto(entity: Device, dto: Partial<CreateDeviceDto> & Partial<UpdateDeviceDto>): Device {
  if (dto.setupId !== undefined) entity.setupId = dto.setupId;
  if (dto.name !== undefined) entity.name = dto.name;
  if (dto.type !== undefined) entity.type = dto.type;
  if (dto.inventoryStatus !== undefined) entity.inventoryStatus = dto.inventoryStatus;
  if (dto.powerRequired !== undefined) entity.powerRequired = dto.powerRequired;
  if (dto.powerSourceType !== undefined) entity.powerSourceType = dto.powerSourceType;
  if (dto.hostUsbType !== undefined) entity.hostUsbType = dto.hostUsbType;
  if (dto.ownerRole !== undefined) entity.ownerRole = dto.ownerRole ?? null;
  if (dto.parentDeviceId !== undefined) entity.parentDeviceId = dto.parentDeviceId ?? null;
  if (dto.position) {
    entity.positionX = dto.position.x;
    entity.positionY = dto.position.y;
  }
  if (dto.power) {
    entity.powerCurrentType = dto.power.currentType ?? null;
    entity.powerVoltageV = dto.power.voltageV ?? null;
    entity.powerCurrentMA = dto.power.currentMA ?? null;
    entity.powerPolarity = dto.power.polarity ?? null;
    entity.powerMaxOutputCurrentMA = dto.power.maxOutputCurrentMA ?? null;
    entity.powerMaxOutputPowerW = dto.power.maxOutputPowerW ?? null;
  }
  if (dto.pedal) {
    entity.pedalIsStereoIn = dto.pedal.isStereoIn ?? null;
    entity.pedalIsStereoOut = dto.pedal.isStereoOut ?? null;
    entity.pedalHasPresets = dto.pedal.hasPresets ?? null;
    entity.pedalPresetCount = dto.pedal.presetCount ?? null;
    entity.pedalHasMidiControl = dto.pedal.hasMidiControl ?? null;
    entity.pedalSmartModes = dto.pedal.smartModes ?? null;
  }
  if (dto.imageUrl !== undefined) entity.imageUrl = dto.imageUrl ?? null;
  if (dto.imageUrls !== undefined) entity.imageUrls = dto.imageUrls ?? null;
  if (dto.notes !== undefined) entity.notes = dto.notes ?? null;
  if (dto.attrs !== undefined) entity.attrs = dto.attrs;
  return entity;
}

export function toPortDto(p: Port): PortDto {
  return {
    id: p.id,
    deviceId: p.deviceId,
    name: p.name,
    portType: p.portType,
    direction: p.direction,
    signalFormat: p.signalFormat,
    power: {
      currentType: p.powerCurrentType ?? undefined,
      voltageV: p.powerVoltageV ?? undefined,
      currentMA: p.powerCurrentMA ?? undefined,
      polarity: p.powerPolarity ?? undefined,
      maxOutputCurrentMA: p.powerMaxOutputCurrentMA ?? undefined,
      maxOutputPowerW: p.powerMaxOutputPowerW ?? undefined,
    },
  };
}

export function applyPortDto(entity: Port, dto: Partial<CreatePortDto> & Partial<UpdatePortDto>): Port {
  if (dto.deviceId !== undefined) entity.deviceId = dto.deviceId;
  if (dto.name !== undefined) entity.name = dto.name;
  if (dto.portType !== undefined) entity.portType = dto.portType;
  if (dto.direction !== undefined) entity.direction = dto.direction;
  if (dto.signalFormat !== undefined) entity.signalFormat = dto.signalFormat ?? null;
  if (dto.power) {
    entity.powerCurrentType = dto.power.currentType ?? null;
    entity.powerVoltageV = dto.power.voltageV ?? null;
    entity.powerCurrentMA = dto.power.currentMA ?? null;
    entity.powerPolarity = dto.power.polarity ?? null;
    entity.powerMaxOutputCurrentMA = dto.power.maxOutputCurrentMA ?? null;
    entity.powerMaxOutputPowerW = dto.power.maxOutputPowerW ?? null;
  }
  return entity;
}

export function toAdapterDto(a: Adapter): AdapterDto {
  return {
    id: a.id,
    name: a.name,
    inputType: a.inputType,
    outputType: a.outputType,
    isActive: a.isActive,
    invertsPolarity: a.invertsPolarity,
  };
}

export function applyAdapterDto(entity: Adapter, dto: Partial<CreateAdapterDto> & Partial<UpdateAdapterDto>): Adapter {
  if (dto.name !== undefined) entity.name = dto.name;
  if (dto.inputType !== undefined) entity.inputType = dto.inputType;
  if (dto.outputType !== undefined) entity.outputType = dto.outputType;
  if (dto.isActive !== undefined) entity.isActive = dto.isActive;
  if (dto.invertsPolarity !== undefined) entity.invertsPolarity = dto.invertsPolarity;
  return entity;
}

export function toCableDto(c: Cable): CableDto {
  return {
    id: c.id,
    sourcePortId: c.sourcePortId,
    targetPortId: c.targetPortId,
    cableType: c.cableType,
    length: c.length,
    adapterId: c.adapterId,
    isUserOwned: c.isUserOwned,
    color: c.color,
    productName: c.productName,
    isPatchCable: c.isPatchCable,
    imageUrl: c.imageUrl,
    textureStartUrl: c.textureStartUrl,
    textureEndUrl: c.textureEndUrl,
    textureMiddleUrl: c.textureMiddleUrl,
  };
}

export function applyCableDto(entity: Cable, dto: Partial<CreateCableDto> & Partial<UpdateCableDto>): Cable {
  if (dto.sourcePortId !== undefined) entity.sourcePortId = dto.sourcePortId;
  if (dto.targetPortId !== undefined) entity.targetPortId = dto.targetPortId;
  if (dto.cableType !== undefined) entity.cableType = dto.cableType;
  if (dto.length !== undefined) entity.length = dto.length;
  if (dto.adapterId !== undefined) entity.adapterId = dto.adapterId ?? null;
  if (dto.isUserOwned !== undefined) entity.isUserOwned = dto.isUserOwned;
  if (dto.color !== undefined) entity.color = dto.color ?? null;
  if (dto.productName !== undefined) entity.productName = dto.productName ?? null;
  if (dto.isPatchCable !== undefined) entity.isPatchCable = dto.isPatchCable;
  if (dto.imageUrl !== undefined) entity.imageUrl = dto.imageUrl ?? null;
  if (dto.textureStartUrl !== undefined) entity.textureStartUrl = dto.textureStartUrl ?? null;
  if (dto.textureEndUrl !== undefined) entity.textureEndUrl = dto.textureEndUrl ?? null;
  if (dto.textureMiddleUrl !== undefined) entity.textureMiddleUrl = dto.textureMiddleUrl ?? null;
  return entity;
}

export function toFurnitureDto(f: Furniture): FurnitureDto {
  return { id: f.id, deviceId: f.deviceId, kind: f.kind, isVenueProvided: f.isVenueProvided };
}

export function applyFurnitureDto(entity: Furniture, dto: Partial<CreateFurnitureDto> & Partial<UpdateFurnitureDto>): Furniture {
  if (dto.deviceId !== undefined) entity.deviceId = dto.deviceId;
  if (dto.kind !== undefined) entity.kind = dto.kind;
  if (dto.isVenueProvided !== undefined) entity.isVenueProvided = dto.isVenueProvided;
  return entity;
}
