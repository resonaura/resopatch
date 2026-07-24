import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { createCableSchema, updateCableSchema } from '@resopatch/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CablesService } from './cables.service.js';

@UseGuards(AuthGuard)
@Controller('cables')
export class CablesController {
  constructor(private readonly cablesService: CablesService) {}

  @Get()
  findBySetup(@Query('setupId') setupId: string) {
    return this.cablesService.findBySetup(setupId);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createCableSchema))
  create(@Body() body: ReturnType<typeof createCableSchema.parse>) {
    return this.cablesService.create(body);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateCableSchema))
  update(@Param('id') id: string, @Body() body: ReturnType<typeof updateCableSchema.parse>) {
    return this.cablesService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cablesService.remove(id);
  }
}
