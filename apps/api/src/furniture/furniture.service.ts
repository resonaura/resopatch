import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateFurnitureDto, FurnitureDto, UpdateFurnitureDto } from '@resopatch/shared';
import { Furniture } from '../database/entities/furniture.entity';
import { applyFurnitureDto, toFurnitureDto } from '../database/mappers';

@Injectable()
export class FurnitureService {
  constructor(@InjectRepository(Furniture) private readonly furniture: Repository<Furniture>) {}

  async findBySetup(setupId: string): Promise<FurnitureDto[]> {
    const furniture = await this.furniture
      .createQueryBuilder('furniture')
      .innerJoin('furniture.device', 'device')
      .where('device.setupId = :setupId', { setupId })
      .getMany();
    return furniture.map(toFurnitureDto);
  }

  async findOne(id: string): Promise<FurnitureDto> {
    const furniture = await this.furniture.findOne({ where: { id } });
    if (!furniture) throw new NotFoundException('Furniture not found.');
    return toFurnitureDto(furniture);
  }

  async create(dto: CreateFurnitureDto): Promise<FurnitureDto> {
    const furniture = applyFurnitureDto(this.furniture.create(), dto);
    await this.furniture.save(furniture);
    return toFurnitureDto(furniture);
  }

  async update(id: string, dto: UpdateFurnitureDto): Promise<FurnitureDto> {
    const furniture = await this.furniture.findOne({ where: { id } });
    if (!furniture) throw new NotFoundException('Furniture not found.');
    applyFurnitureDto(furniture, dto);
    await this.furniture.save(furniture);
    return toFurnitureDto(furniture);
  }

  async remove(id: string): Promise<void> {
    const result = await this.furniture.delete(id);
    if (!result.affected) throw new NotFoundException('Furniture not found.');
  }
}
