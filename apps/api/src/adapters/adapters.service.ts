import { Injectable, NotFoundException } from '@nestjs/common';
import { AdapterDto, CreateAdapterDto, UpdateAdapterDto } from '@resopatch/shared';
import { applyAdapterDto, toAdapterDto } from '../database/mappers.js';
import { adaptersRepo } from '../database/json-db.js';

@Injectable()
export class AdaptersService {
  async findAll(): Promise<AdapterDto[]> {
    const adapters = await adaptersRepo.find({ order: { name: 'ASC' } });
    return adapters.map(toAdapterDto);
  }

  async findOne(id: string): Promise<AdapterDto> {
    const adapter = await adaptersRepo.findOne({ where: { id } });
    if (!adapter) throw new NotFoundException('Adapter not found.');
    return toAdapterDto(adapter);
  }

  async create(dto: CreateAdapterDto): Promise<AdapterDto> {
    const adapter = applyAdapterDto(adaptersRepo.create(), dto);
    await adaptersRepo.save(adapter);
    return toAdapterDto(adapter);
  }

  async update(id: string, dto: UpdateAdapterDto): Promise<AdapterDto> {
    const adapter = await adaptersRepo.findOne({ where: { id } });
    if (!adapter) throw new NotFoundException('Adapter not found.');
    applyAdapterDto(adapter, dto);
    await adaptersRepo.save(adapter);
    return toAdapterDto(adapter);
  }

  async remove(id: string): Promise<void> {
    const result = await adaptersRepo.delete(id);
    if (!result.affected) throw new NotFoundException('Adapter not found.');
  }
}
