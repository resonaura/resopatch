import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { createPortSchema, updatePortSchema } from '@resopatch/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PortsService } from './ports.service.js';

@UseGuards(AuthGuard)
@Controller('ports')
export class PortsController {
  constructor(private readonly portsService: PortsService) {}

  @Get()
  findByDevice(@Query('deviceId') deviceId: string) {
    return this.portsService.findByDevice(deviceId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.portsService.findOne(id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createPortSchema))
  create(@Body() body: ReturnType<typeof createPortSchema.parse>) {
    return this.portsService.create(body);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updatePortSchema))
  update(@Param('id') id: string, @Body() body: ReturnType<typeof updatePortSchema.parse>) {
    return this.portsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.portsService.remove(id);
  }
}
