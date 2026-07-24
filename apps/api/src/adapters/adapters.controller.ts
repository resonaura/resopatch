import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UsePipes } from '@nestjs/common';
import { createAdapterSchema, updateAdapterSchema } from '@resopatch/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdaptersService } from './adapters.service.js';

@UseGuards(AuthGuard)
@Controller('adapters')
export class AdaptersController {
  constructor(private readonly adaptersService: AdaptersService) {}

  @Get()
  findAll() {
    return this.adaptersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adaptersService.findOne(id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createAdapterSchema))
  create(@Body() body: ReturnType<typeof createAdapterSchema.parse>) {
    return this.adaptersService.create(body);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateAdapterSchema))
  update(@Param('id') id: string, @Body() body: ReturnType<typeof updateAdapterSchema.parse>) {
    return this.adaptersService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adaptersService.remove(id);
  }
}
