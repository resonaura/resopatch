import { Injectable, NotFoundException } from '@nestjs/common';
import { AutoLayoutDto, CreateSetupDto, DeviceType, InputListRow, InventoryStatus, RiderRow, SetupDto, UpdateSetupDto } from '@resopatch/shared';
import { adaptersRepo, cablesRepo, devicesRepo, furnitureRepo, In, portsRepo, setupsRepo } from '../database/json-db.js';
import { toAdapterDto, toCableDto, toDeviceDto, toFurnitureDto, toPortDto, toSetupDto } from '../database/mappers.js';

@Injectable()
export class SetupsService {
  async findAll(): Promise<SetupDto[]> {
    const setups = await setupsRepo.find({ order: { createdAt: 'ASC' } });
    return setups.map(toSetupDto);
  }

  async findOne(id: string): Promise<SetupDto> {
    const setup = await setupsRepo.findOne({ where: { id } });
    if (!setup) throw new NotFoundException('Setup not found.');
    return toSetupDto(setup);
  }

  async create(dto: CreateSetupDto): Promise<SetupDto> {
    const setup = setupsRepo.create({ name: dto.name, description: dto.description ?? null, checklistState: dto.checklistState ?? null });
    await setupsRepo.save(setup);
    return toSetupDto(setup);
  }

  async update(id: string, dto: UpdateSetupDto): Promise<SetupDto> {
    const setup = await setupsRepo.findOne({ where: { id } });
    if (!setup) throw new NotFoundException('Setup not found.');
    if (dto.name !== undefined) setup.name = dto.name;
    if (dto.description !== undefined) setup.description = dto.description ?? null;
    if (dto.checklistState !== undefined) setup.checklistState = dto.checklistState ?? null;
    await setupsRepo.save(setup);
    return toSetupDto(setup);
  }

  async remove(id: string): Promise<void> {
    const result = await setupsRepo.delete(id);
    if (!result.affected) throw new NotFoundException('Setup not found.');
  }

  /** Full devices/ports/cables/adapters/furniture graph for the patch map canvas. */
  async getGraph(setupId: string) {
    const devices = await devicesRepo.find({ where: { setupId } });
    const deviceIds = devices.map((d) => d.id);
    const ports = deviceIds.length ? await portsRepo.find({ where: { deviceId: In(deviceIds) } }) : [];
    const portsByDevice = new Map<string, typeof ports>();
    for (const p of ports) portsByDevice.set(p.deviceId, [...(portsByDevice.get(p.deviceId) ?? []), p]);
    const furniture = deviceIds.length ? await furnitureRepo.find({ where: { deviceId: In(deviceIds) } }) : [];
    const furnitureByDevice = new Map(furniture.map((f) => [f.deviceId, f]));

    const portIds = ports.map((p) => p.id);
    const cables = portIds.length ? await cablesRepo.find({ where: { sourcePortId: In(portIds) } }) : [];
    const adapterIds = [...new Set(cables.map((c) => c.adapterId).filter((id): id is string => Boolean(id)))];
    const adapters = adapterIds.length ? await adaptersRepo.find({ where: { id: In(adapterIds) } }) : [];
    const adapterById = new Map(adapters.map((a) => [a.id, a]));

    return {
      devices: devices.map((d) => ({
        ...toDeviceDto(d),
        ports: (portsByDevice.get(d.id) ?? []).map(toPortDto),
        furniture: furnitureByDevice.has(d.id) ? toFurnitureDto(furnitureByDevice.get(d.id)!) : null,
      })),
      cables: cables.map((c) => ({ ...toCableDto(c), adapterName: (c.adapterId && adapterById.get(c.adapterId)?.name) ?? null })),
      adapters: adapters.map(toAdapterDto),
    };
  }

  /** Persists canvas positions computed on the client. Layout / cable routing never runs here —
   *  the browser owns all geometry; this endpoint is only the durable save of those positions. */
  async autoLayout(setupId: string, dto: AutoLayoutDto): Promise<{ updated: number }> {
    const devices = await devicesRepo.find({ where: { setupId } });
    let updated = 0;
    for (const device of devices) {
      const pos = dto.positions[device.id];
      if (!pos) continue;
      device.positionX = pos.x;
      device.positionY = pos.y;
      updated += 1;
    }
    if (updated > 0) await devicesRepo.save(devices);
    return { updated };
  }

  /** Derived input list (Table 6): one row per cable feeding a STAGE_BOX device.
   *  When `hasKeys` is false, devices/accessories flagged `attrs.isKeysOnly` (and anything wired
   *  only through them) are excluded — same convention the canvas's setup-mode switcher uses. */
  async getInputList(setupId: string, hasKeys = true): Promise<InputListRow[]> {
    const devices = (await devicesRepo.find({ where: { setupId } })).filter((d) => hasKeys || !d.attrs?.isKeysOnly);
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    const deviceIds = devices.map((d) => d.id);
    const ports = deviceIds.length ? await portsRepo.find({ where: { deviceId: In(deviceIds) } }) : [];
    const portById = new Map(ports.map((p) => [p.id, p]));
    const portIds = ports.map((p) => p.id);

    const cables = portIds.length
      ? await cablesRepo.find({ where: { sourcePortId: In(portIds) }, order: { createdAt: 'ASC' } })
      : [];
    const adapterIds = [...new Set(cables.map((c) => c.adapterId).filter((id): id is string => Boolean(id)))];
    const adapters = adapterIds.length ? await adaptersRepo.find({ where: { id: In(adapterIds) } }) : [];
    const adapterById = new Map(adapters.map((a) => [a.id, a]));

    return cables
      .map((c) => ({
        cable: c,
        sourcePort: portById.get(c.sourcePortId),
        targetPort: portById.get(c.targetPortId),
      }))
      .filter((row): row is typeof row & { sourcePort: NonNullable<typeof row.sourcePort>; targetPort: NonNullable<typeof row.targetPort> } => {
        if (!row.sourcePort || !row.targetPort) return false;
        const targetDevice = deviceById.get(row.targetPort.deviceId);
        return targetDevice?.type === DeviceType.STAGE_BOX;
      })
      .map((row, index) => {
        const sourceDevice = deviceById.get(row.sourcePort.deviceId);
        const adapter = row.cable.adapterId ? adapterById.get(row.cable.adapterId) : undefined;
        return {
          channel: index + 1,
          sourceDeviceName: sourceDevice?.name ?? '?',
          sourcePortName: row.sourcePort.name,
          connector: row.sourcePort.portType,
          direction: row.sourcePort.direction,
          adapterName: adapter?.name ?? null,
          phantomPower: false,
          zone: sourceDevice?.ownerRole ?? 'Stage',
          owner: sourceDevice?.ownerRole ?? '—',
        };
      });
  }

  /** Derived packing/rider checklist (Table 7): cables, adapters, furniture and power needs grouped by ownership.
   *  When `hasKeys` is false, devices/accessories flagged `attrs.isKeysOnly` are excluded — same
   *  convention the canvas's setup-mode switcher uses. */
  async getRider(setupId: string, hasKeys = true): Promise<RiderRow[]> {
    const devices = (await devicesRepo.find({ where: { setupId } })).filter((d) => hasKeys || !d.attrs?.isKeysOnly);
    const deviceIds = devices.map((d) => d.id);
    const furniture = deviceIds.length ? await furnitureRepo.find({ where: { deviceId: In(deviceIds) } }) : [];
    const furnitureByDevice = new Map(furniture.map((f) => [f.deviceId, f]));
    const ports = deviceIds.length ? await portsRepo.find({ where: { deviceId: In(deviceIds) } }) : [];
    const portIds = ports.map((p) => p.id);
    const cables = portIds.length ? await cablesRepo.find({ where: { sourcePortId: In(portIds) } }) : [];
    const adapterIds = [...new Set(cables.map((c) => c.adapterId).filter((id): id is string => Boolean(id)))];
    const adapters = adapterIds.length ? await adaptersRepo.find({ where: { id: In(adapterIds) } }) : [];
    const adapterById = new Map(adapters.map((a) => [a.id, a]));

    const rows: RiderRow[] = [];

    const cableGroups = new Map<string, { quantity: number; isUserOwned: boolean; length: number; cableType: string }>();
    for (const c of cables) {
      const key = `${c.cableType}|${c.length}|${c.isUserOwned}`;
      const group = cableGroups.get(key) ?? { quantity: 0, isUserOwned: c.isUserOwned, length: c.length, cableType: c.cableType };
      group.quantity += 1;
      cableGroups.set(key, group);
    }
    for (const group of cableGroups.values()) {
      rows.push({
        category: 'CABLE',
        name: `${group.cableType} (${group.length}m)`,
        quantity: group.quantity,
        isUserOwned: group.isUserOwned,
      });
    }

    const adapterGroups = new Map<string, number>();
    for (const c of cables) {
      const adapter = c.adapterId ? adapterById.get(c.adapterId) : undefined;
      if (adapter) adapterGroups.set(adapter.name, (adapterGroups.get(adapter.name) ?? 0) + 1);
    }
    for (const [name, quantity] of adapterGroups) {
      rows.push({ category: 'ADAPTER', name, quantity, isUserOwned: true });
    }

    for (const device of devices) {
      if (device.inventoryStatus === InventoryStatus.VENUE_PROVIDED) {
        rows.push({
          category: 'EQUIPMENT',
          name: device.name,
          quantity: 1,
          isUserOwned: false,
          note: device.notes ?? undefined,
        });
      }
      const deviceFurniture = furnitureByDevice.get(device.id);
      if (deviceFurniture) {
        rows.push({
          category: 'FURNITURE',
          name: deviceFurniture.kind,
          quantity: 1,
          isUserOwned: !deviceFurniture.isVenueProvided,
          note: device.name,
        });
      }
    }

    for (const device of devices) {
      if (device.powerRequired && device.inventoryStatus !== InventoryStatus.VENUE_PROVIDED) {
        rows.push({
          category: 'POWER',
          name: `${device.name} power (${device.powerSourceType})`,
          quantity: 1,
          isUserOwned: true,
        });
      }
    }

    return rows;
  }
}
