import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from './app.module.js';

import { seedDatabase } from './database/seed.js';

async function bootstrap() {
  // TEMPORARY: Auto-reseed on every server startup per request
  try {
    await seedDatabase();
  } catch (err) {
    console.error('Failed to auto-reseed database on startup:', err);
  }

  const adapter = new FastifyAdapter({
    // Device photos are client-compressed before upload (see apps/web/src/lib/imageUpload.ts),
    // but this raises the ceiling generously rather than relying on that alone.
    bodyLimit: 10 * 1024 * 1024,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  await app.register(fastifyCookie);
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`resopatch API listening on http://localhost:${port}`);
}

bootstrap();
