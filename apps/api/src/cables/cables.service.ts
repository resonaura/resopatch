import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CableDto, CableType, CreateCableDto, PortDirection, PortType, UpdateCableDto, validateConnection } from '@resopatch/shared';
import { applyCableDto, toCableDto } from '../database/mappers.js';
import { adaptersRepo, cablesRepo, devicesRepo, portsRepo, In } from '../database/json-db.js';

@Injectable()
export class CablesService {
  async findBySetup(setupId: string): Promise<CableDto[]> {
    const deviceIds = (await devicesRepo.find({ where: { setupId } })).map((d) => d.id);
    const portIds = deviceIds.length ? (await portsRepo.find({ where: { deviceId: In(deviceIds) } })).map((p) => p.id) : [];
    const cables = portIds.length ? await cablesRepo.find({ where: { sourcePortId: In(portIds) } }) : [];
    return cables.map(toCableDto);
  }

  private async assertValid(sourcePortId: string, targetPortId: string, cableType: string, adapterId?: string | null) {
    const [sourcePort, targetPort, adapter] = await Promise.all([
      portsRepo.findOne({ where: { id: sourcePortId } }),
      portsRepo.findOne({ where: { id: targetPortId } }),
      adapterId ? adaptersRepo.findOne({ where: { id: adapterId } }) : Promise.resolve(null),
    ]);
    if (!sourcePort) throw new NotFoundException('Source port not found.');
    if (!targetPort) throw new NotFoundException('Target port not found.');
    if (adapterId && !adapter) throw new NotFoundException('Adapter not found.');

    const result = validateConnection({
      sourcePortType: sourcePort.portType as PortType,
      sourceDirection: sourcePort.direction as PortDirection,
      targetPortType: targetPort.portType as PortType,
      targetDirection: targetPort.direction as PortDirection,
      cableType: cableType as CableType,
      adapter: adapter
        ? { inputType: adapter.inputType as PortType, outputType: adapter.outputType as PortType, invertsPolarity: adapter.invertsPolarity }
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
    const cable = applyCableDto(cablesRepo.create(), dto);
    await cablesRepo.save(cable);
    return toCableDto(cable);
  }

  async update(id: string, dto: UpdateCableDto): Promise<CableDto> {
    const existing = await cablesRepo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Cable not found.');

    await this.assertValid(
      dto.sourcePortId ?? existing.sourcePortId,
      dto.targetPortId ?? existing.targetPortId,
      dto.cableType ?? existing.cableType,
      dto.adapterId !== undefined ? dto.adapterId : existing.adapterId,
    );

    applyCableDto(existing, dto);
    await cablesRepo.save(existing);
    return toCableDto(existing);
  }

  async remove(id: string): Promise<void> {
    const result = await cablesRepo.delete(id);
    if (!result.affected) throw new NotFoundException('Cable not found.');
  }
}
