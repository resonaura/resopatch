import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CableDto, CreateCableDto, UpdateCableDto, validateConnection } from '@resopatch/shared';
import { Cable } from '../database/entities/cable.entity';
import { Port } from '../database/entities/port.entity';
import { Adapter } from '../database/entities/adapter.entity';
import { applyCableDto, toCableDto } from '../database/mappers';

@Injectable()
export class CablesService {
  constructor(
    @InjectRepository(Cable) private readonly cables: Repository<Cable>,
    @InjectRepository(Port) private readonly ports: Repository<Port>,
    @InjectRepository(Adapter) private readonly adapters: Repository<Adapter>,
  ) {}

  async findBySetup(setupId: string): Promise<CableDto[]> {
    const cables = await this.cables
      .createQueryBuilder('cable')
      .innerJoin('cable.sourcePort', 'sourcePort')
      .innerJoin('sourcePort.device', 'device')
      .where('device.setupId = :setupId', { setupId })
      .getMany();
    return cables.map(toCableDto);
  }

  private async assertValid(sourcePortId: string, targetPortId: string, cableType: string, adapterId?: string | null) {
    const [sourcePort, targetPort, adapter] = await Promise.all([
      this.ports.findOne({ where: { id: sourcePortId } }),
      this.ports.findOne({ where: { id: targetPortId } }),
      adapterId ? this.adapters.findOne({ where: { id: adapterId } }) : Promise.resolve(null),
    ]);
    if (!sourcePort) throw new NotFoundException('Source port not found.');
    if (!targetPort) throw new NotFoundException('Target port not found.');
    if (adapterId && !adapter) throw new NotFoundException('Adapter not found.');

    const result = validateConnection({
      sourcePortType: sourcePort.portType as any,
      sourceDirection: sourcePort.direction as any,
      targetPortType: targetPort.portType as any,
      targetDirection: targetPort.direction as any,
      cableType: cableType as any,
      adapter: adapter
        ? { inputType: adapter.inputType as any, outputType: adapter.outputType as any, invertsPolarity: adapter.invertsPolarity }
        : undefined,
      sourcePower: {
        currentType: sourcePort.powerCurrentType ?? undefined,
        voltageV: sourcePort.powerVoltageV ?? undefined,
        currentMA: sourcePort.powerCurrentMA ?? undefined,
        polarity: sourcePort.powerPolarity ?? undefined,
      },
      targetPower: {
        currentType: targetPort.powerCurrentType ?? undefined,
        voltageV: targetPort.powerVoltageV ?? undefined,
        currentMA: targetPort.powerCurrentMA ?? undefined,
        polarity: targetPort.powerPolarity ?? undefined,
      },
    });

    if (!result.valid) {
      throw new BadRequestException(result.error);
    }
    return result.warnings;
  }

  async create(dto: CreateCableDto): Promise<CableDto> {
    await this.assertValid(dto.sourcePortId, dto.targetPortId, dto.cableType, dto.adapterId);
    const cable = applyCableDto(this.cables.create(), dto);
    await this.cables.save(cable);
    return toCableDto(cable);
  }

  async update(id: string, dto: UpdateCableDto): Promise<CableDto> {
    const existing = await this.cables.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Cable not found.');

    await this.assertValid(
      dto.sourcePortId ?? existing.sourcePortId,
      dto.targetPortId ?? existing.targetPortId,
      dto.cableType ?? existing.cableType,
      dto.adapterId !== undefined ? dto.adapterId : existing.adapterId,
    );

    applyCableDto(existing, dto);
    await this.cables.save(existing);
    return toCableDto(existing);
  }

  async remove(id: string): Promise<void> {
    const result = await this.cables.delete(id);
    if (!result.affected) throw new NotFoundException('Cable not found.');
  }
}
