import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { createFurnitureSchema, updateFurnitureSchema } from '@resopatch/shared';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FurnitureService } from './furniture.service';

@UseGuards(AuthGuard)
@Controller('furniture')
export class FurnitureController {
  constructor(private readonly furnitureService: FurnitureService) {}

  @Get()
  findBySetup(@Query('setupId') setupId: string) {
    return this.furnitureService.findBySetup(setupId);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createFurnitureSchema))
  create(@Body() body: ReturnType<typeof createFurnitureSchema.parse>) {
    return this.furnitureService.create(body);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateFurnitureSchema))
  update(@Param('id') id: string, @Body() body: ReturnType<typeof updateFurnitureSchema.parse>) {
    return this.furnitureService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.furnitureService.remove(id);
  }
}
