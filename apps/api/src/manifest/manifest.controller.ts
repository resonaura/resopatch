import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CacheService } from '../cache/cache.service.js';

@Controller('img-manifest')
export class ManifestController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  async getManifest(@Res() reply: FastifyReply): Promise<void> {
    const manifest = await this.cache.getManifest();
    reply.header('Cache-Control', 'no-cache').send(manifest);
  }
}
