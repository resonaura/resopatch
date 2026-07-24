import { Injectable } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { SetupsService } from '../setups/setups.service.js';

@Injectable()
export class ExportService {
  constructor(private readonly setupsService: SetupsService) {}

  async exportPdf(setupId: string): Promise<Buffer> {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(`${webOrigin}/print/setup/${setupId}`, { waitUntil: 'networkidle0' });
      await page.emulateMediaType('print');
      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  async exportText(setupId: string): Promise<string> {
    const setup = await this.setupsService.findOne(setupId);
    const inputList = await this.setupsService.getInputList(setupId);
    const rider = await this.setupsService.getRider(setupId);

    const lines: string[] = [];
    lines.push(`${setup.name}`, '='.repeat(setup.name.length), '');
    lines.push('INPUT LIST', '-'.repeat(10));
    for (const row of inputList) {
      lines.push(
        `CH ${String(row.channel).padStart(2, '0')} | ${row.sourceName} | ${row.connector} | ${row.routing} | Zone: ${row.zone} | Owner: ${row.owner}`,
      );
    }
    lines.push('', 'RIDER / PACKING LIST', '-'.repeat(20));
    const owned = rider.filter((r) => r.isUserOwned);
    const venue = rider.filter((r) => !r.isUserOwned);
    lines.push('Band brings:');
    for (const row of owned) lines.push(`  [ ] x${row.quantity} ${row.name}${row.note ? ` (${row.note})` : ''}`);
    lines.push('Venue provides:');
    for (const row of venue) lines.push(`  [ ] x${row.quantity} ${row.name}${row.note ? ` (${row.note})` : ''}`);

    return lines.join('\n');
  }
}
