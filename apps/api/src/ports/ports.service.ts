import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePortDto, PortDto, UpdatePortDto } from '@resopatch/shared';
import { Port } from '../database/entities/port.entity';
import { applyPortDto, toPortDto } from '../database/mappers';

@Injectable()
export class PortsService {
  constructor(@InjectRepository(Port) private readonly ports: Repository<Port>) {}

  async findByDevice(deviceId: string): Promise<PortDto[]> {
    const ports = await this.ports.find({ where: { deviceId } });
    return ports.map(toPortDto);
  }

  async findOne(id: string): Promise<PortDto> {
    const port = await this.ports.findOne({ where: { id } });
    if (!port) throw new NotFoundException('Port not found.');
    return toPortDto(port);
  }

  async create(dto: CreatePortDto): Promise<PortDto> {
    const port = applyPortDto(this.ports.create(), dto);
    await this.ports.save(port);
    return toPortDto(port);
  }

  async update(id: string, dto: UpdatePortDto): Promise<PortDto> {
    const port = await this.ports.findOne({ where: { id } });
    if (!port) throw new NotFoundException('Port not found.');
    applyPortDto(port, dto);
    await this.ports.save(port);
    return toPortDto(port);
  }

  async remove(id: string): Promise<void> {
    const result = await this.ports.delete(id);
    if (!result.affected) throw new NotFoundException('Port not found.');
  }
}
