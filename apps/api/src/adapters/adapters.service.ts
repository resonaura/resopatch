import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdapterDto, CreateAdapterDto, UpdateAdapterDto } from '@resopatch/shared';
import { Adapter } from '../database/entities/adapter.entity';
import { applyAdapterDto, toAdapterDto } from '../database/mappers';

@Injectable()
export class AdaptersService {
  constructor(@InjectRepository(Adapter) private readonly adapters: Repository<Adapter>) {}

  async findAll(): Promise<AdapterDto[]> {
    const adapters = await this.adapters.find({ order: { name: 'ASC' } });
    return adapters.map(toAdapterDto);
  }

  async findOne(id: string): Promise<AdapterDto> {
    const adapter = await this.adapters.findOne({ where: { id } });
    if (!adapter) throw new NotFoundException('Adapter not found.');
    return toAdapterDto(adapter);
  }

  async create(dto: CreateAdapterDto): Promise<AdapterDto> {
    const adapter = applyAdapterDto(this.adapters.create(), dto);
    await this.adapters.save(adapter);
    return toAdapterDto(adapter);
  }

  async update(id: string, dto: UpdateAdapterDto): Promise<AdapterDto> {
    const adapter = await this.adapters.findOne({ where: { id } });
    if (!adapter) throw new NotFoundException('Adapter not found.');
    applyAdapterDto(adapter, dto);
    await this.adapters.save(adapter);
    return toAdapterDto(adapter);
  }

  async remove(id: string): Promise<void> {
    const result = await this.adapters.delete(id);
    if (!result.affected) throw new NotFoundException('Adapter not found.');
  }
}
