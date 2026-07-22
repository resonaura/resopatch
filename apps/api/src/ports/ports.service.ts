import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePortDto, PortDto, UpdatePortDto } from '@resopatch/shared';
import { applyPortDto, toPortDto } from '../database/mappers';
import { portsRepo } from '../database/json-db';

@Injectable()
export class PortsService {
  async findByDevice(deviceId: string): Promise<PortDto[]> {
    const ports = await portsRepo.find({ where: { deviceId } });
    return ports.map(toPortDto);
  }

  async findOne(id: string): Promise<PortDto> {
    const port = await portsRepo.findOne({ where: { id } });
    if (!port) throw new NotFoundException('Port not found.');
    return toPortDto(port);
  }

  async create(dto: CreatePortDto): Promise<PortDto> {
    const port = applyPortDto(portsRepo.create(), dto);
    await portsRepo.save(port);
    return toPortDto(port);
  }

  async update(id: string, dto: UpdatePortDto): Promise<PortDto> {
    const port = await portsRepo.findOne({ where: { id } });
    if (!port) throw new NotFoundException('Port not found.');
    applyPortDto(port, dto);
    await portsRepo.save(port);
    return toPortDto(port);
  }

  async remove(id: string): Promise<void> {
    const result = await portsRepo.delete(id);
    if (!result.affected) throw new NotFoundException('Port not found.');
  }
}
