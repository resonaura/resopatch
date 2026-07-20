import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UsePipes } from '@nestjs/common';
import { createSetupSchema, updateSetupSchema } from '@resopatch/shared';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SetupsService } from './setups.service';

@UseGuards(AuthGuard)
@Controller('setups')
export class SetupsController {
  constructor(private readonly setupsService: SetupsService) {}

  @Get()
  findAll() {
    return this.setupsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.setupsService.findOne(id);
  }

  @Get(':id/graph')
  getGraph(@Param('id') id: string) {
    return this.setupsService.getGraph(id);
  }

  @Get(':id/input-list')
  getInputList(@Param('id') id: string) {
    return this.setupsService.getInputList(id);
  }

  @Get(':id/rider')
  getRider(@Param('id') id: string) {
    return this.setupsService.getRider(id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createSetupSchema))
  create(@Body() body: ReturnType<typeof createSetupSchema.parse>) {
    return this.setupsService.create(body);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateSetupSchema))
  update(@Param('id') id: string, @Body() body: ReturnType<typeof updateSetupSchema.parse>) {
    return this.setupsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.setupsService.remove(id);
  }
}
