import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { ExportService } from './export.service.js';

@UseGuards(AuthGuard)
@Controller('setups/:id/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('pdf')
  async pdf(@Param('id') id: string, @Res() res: FastifyReply) {
    const buffer = await this.exportService.exportPdf(id);
    res.header('Content-Type', 'application/pdf');
    res.header('Content-Disposition', `attachment; filename="setup-${id}.pdf"`);
    res.send(buffer);
  }

  @Get('text')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async text(@Param('id') id: string) {
    return this.exportService.exportText(id);
  }
}
