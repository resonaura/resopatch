import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CacheService } from '../cache/cache.service';

@Controller('img-manifest')
export class ManifestController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  async getManifest(@Res() reply: Response): Promise<void> {
    const manifest = await this.cache.getManifest();
    reply.header('Cache-Control', 'no-cache').json(manifest);
  }
}
