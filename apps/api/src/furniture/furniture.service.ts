import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateFurnitureDto, FurnitureDto, UpdateFurnitureDto } from '@resopatch/shared';
import { applyFurnitureDto, toFurnitureDto } from '../database/mappers.js';
import { devicesRepo, furnitureRepo, In } from '../database/json-db.js';

@Injectable()
export class FurnitureService {
  async findBySetup(setupId: string): Promise<FurnitureDto[]> {
    const deviceIds = (await devicesRepo.find({ where: { setupId } })).map((d) => d.id);
    const furniture = deviceIds.length ? await furnitureRepo.find({ where: { deviceId: In(deviceIds) } }) : [];
    return furniture.map(toFurnitureDto);
  }

  async findOne(id: string): Promise<FurnitureDto> {
    const furniture = await furnitureRepo.findOne({ where: { id } });
    if (!furniture) throw new NotFoundException('Furniture not found.');
    return toFurnitureDto(furniture);
  }

  async create(dto: CreateFurnitureDto): Promise<FurnitureDto> {
    const furniture = applyFurnitureDto(furnitureRepo.create(), dto);
    await furnitureRepo.save(furniture);
    return toFurnitureDto(furniture);
  }

  async update(id: string, dto: UpdateFurnitureDto): Promise<FurnitureDto> {
    const furniture = await furnitureRepo.findOne({ where: { id } });
    if (!furniture) throw new NotFoundException('Furniture not found.');
    applyFurnitureDto(furniture, dto);
    await furnitureRepo.save(furniture);
    return toFurnitureDto(furniture);
  }

  async remove(id: string): Promise<void> {
    const result = await furnitureRepo.delete(id);
    if (!result.affected) throw new NotFoundException('Furniture not found.');
  }
}
