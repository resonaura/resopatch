import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ExportService } from './export.service';

@UseGuards(AuthGuard)
@Controller('setups/:id/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.exportService.exportPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="setup-${id}.pdf"`);
    res.send(buffer);
  }

  @Get('text')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async text(@Param('id') id: string) {
    return this.exportService.exportText(id);
  }
}
