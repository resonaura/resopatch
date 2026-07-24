import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { createDeviceSchema, updateDeviceSchema } from '@resopatch/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DevicesService } from './devices.service.js';

@UseGuards(AuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  findBySetup(@Query('setupId') setupId: string) {
    return this.devicesService.findBySetup(setupId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createDeviceSchema))
  create(@Body() body: ReturnType<typeof createDeviceSchema.parse>) {
    return this.devicesService.create(body);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateDeviceSchema))
  update(@Param('id') id: string, @Body() body: ReturnType<typeof updateDeviceSchema.parse>) {
    return this.devicesService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.devicesService.remove(id);
  }

  @Get(':id/power-budget')
  getPowerBudget(@Param('id') id: string) {
    return this.devicesService.getPowerBudget(id);
  }
}
