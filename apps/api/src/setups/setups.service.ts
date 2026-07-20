import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreateSetupDto, DeviceType, InputListRow, RiderRow, SetupDto, UpdateSetupDto } from '@resopatch/shared';
import { Setup } from '../database/entities/setup.entity';
import { Device } from '../database/entities/device.entity';
import { Port } from '../database/entities/port.entity';
import { Cable } from '../database/entities/cable.entity';
import { Adapter } from '../database/entities/adapter.entity';
import { toAdapterDto, toCableDto, toDeviceDto, toFurnitureDto, toPortDto, toSetupDto } from '../database/mappers';

@Injectable()
export class SetupsService {
  constructor(
    @InjectRepository(Setup) private readonly setups: Repository<Setup>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(Port) private readonly ports: Repository<Port>,
    @InjectRepository(Cable) private readonly cables: Repository<Cable>,
    @InjectRepository(Adapter) private readonly adapters: Repository<Adapter>,
  ) {}

  async findAll(): Promise<SetupDto[]> {
    const setups = await this.setups.find({ order: { createdAt: 'ASC' } });
    return setups.map(toSetupDto);
  }

  async findOne(id: string): Promise<SetupDto> {
    const setup = await this.setups.findOne({ where: { id } });
    if (!setup) throw new NotFoundException('Setup not found.');
    return toSetupDto(setup);
  }

  async create(dto: CreateSetupDto): Promise<SetupDto> {
    const setup = this.setups.create({ name: dto.name, description: dto.description ?? null });
    await this.setups.save(setup);
    return toSetupDto(setup);
  }

  async update(id: string, dto: UpdateSetupDto): Promise<SetupDto> {
    const setup = await this.setups.findOne({ where: { id } });
    if (!setup) throw new NotFoundException('Setup not found.');
    if (dto.name !== undefined) setup.name = dto.name;
    if (dto.description !== undefined) setup.description = dto.description ?? null;
    await this.setups.save(setup);
    return toSetupDto(setup);
  }

  async remove(id: string): Promise<void> {
    const result = await this.setups.delete(id);
    if (!result.affected) throw new NotFoundException('Setup not found.');
  }

  /** Full devices/ports/cables/adapters/furniture graph for the patch map canvas. */
  async getGraph(setupId: string) {
    const devices = await this.devices.find({ where: { setupId }, relations: { ports: true, furniture: true } });
    const portIds = devices.flatMap((d) => d.ports.map((p) => p.id));
    const cables = portIds.length
      ? await this.cables.find({ where: { sourcePortId: In(portIds) }, relations: { adapter: true } })
      : [];
    const adapterIds = [...new Set(cables.map((c) => c.adapterId).filter((id): id is string => Boolean(id)))];
    const adapters = adapterIds.length ? await this.adapters.find({ where: { id: In(adapterIds) } }) : [];

    return {
      devices: devices.map((d) => ({
        ...toDeviceDto(d),
        ports: d.ports.map(toPortDto),
        furniture: d.furniture ? toFurnitureDto(d.furniture) : null,
      })),
      cables: cables.map((c) => ({ ...toCableDto(c), adapterName: c.adapter?.name ?? null })),
      adapters: adapters.map(toAdapterDto),
    };
  }

  /** Derived input list (Table 6): one row per cable feeding a STAGE_BOX device. */
  async getInputList(setupId: string): Promise<InputListRow[]> {
    const devices = await this.devices.find({ where: { setupId } });
    const deviceIds = devices.map((d) => d.id);
    const portIds = deviceIds.length ? (await this.ports.find({ where: { deviceId: In(deviceIds) } })).map((p) => p.id) : [];

    const cables = portIds.length
      ? await this.cables.find({
          where: { sourcePortId: In(portIds) },
          relations: { adapter: true, sourcePort: { device: true }, targetPort: { device: true } },
          order: { createdAt: 'ASC' },
        })
      : [];

    return cables
      .filter((c) => c.targetPort.device.type === DeviceType.STAGE_BOX)
      .map((c, index) => ({
        channel: index + 1,
        sourceName: `${c.sourcePort.device.name} — ${c.sourcePort.name}`,
        connector: c.sourcePort.portType,
        direction: c.sourcePort.direction,
        routing: c.adapter ? `Through ${c.adapter.name}` : `Direct from ${c.sourcePort.device.name}`,
        phantomPower: false,
        zone: c.sourcePort.device.ownerRole ?? 'Stage',
        owner: c.sourcePort.device.ownerRole ?? '—',
      }));
  }

  /** Derived packing/rider checklist (Table 7): cables, adapters, furniture and power needs grouped by ownership. */
  async getRider(setupId: string): Promise<RiderRow[]> {
    const devices = await this.devices.find({ where: { setupId }, relations: { furniture: true } });
    const deviceIds = devices.map((d) => d.id);
    const portIds = deviceIds.length ? (await this.ports.find({ where: { deviceId: In(deviceIds) } })).map((p) => p.id) : [];
    const cables = portIds.length
      ? await this.cables.find({ where: { sourcePortId: In(portIds) }, relations: { adapter: true } })
      : [];

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
      if (c.adapter) adapterGroups.set(c.adapter.name, (adapterGroups.get(c.adapter.name) ?? 0) + 1);
    }
    for (const [name, quantity] of adapterGroups) {
      rows.push({ category: 'ADAPTER', name, quantity, isUserOwned: true });
    }

    for (const device of devices) {
      if (device.furniture) {
        rows.push({
          category: 'FURNITURE',
          name: device.furniture.kind,
          quantity: 1,
          isUserOwned: !device.furniture.isVenueProvided,
          note: device.name,
        });
      }
    }

    for (const device of devices) {
      if (device.powerRequired) {
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
