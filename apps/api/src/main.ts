import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

import { seedDatabase } from './database/seed';

async function bootstrap() {
  // TEMPORARY: Auto-reseed on every server startup per request
  try {
    await seedDatabase();
  } catch (err) {
    console.error('Failed to auto-reseed database on startup:', err);
  }

  // Nest registers its own (100kb-limited) body parser inside NestFactory.create() itself, before
  // any code here gets to run — too early to override by just calling useBodyParser() afterwards,
  // since the default would already be first in the Express middleware chain. `bodyParser: false`
  // skips that registration so ours is the only one, sized for a device photo's base64 payload
  // (device images are client-compressed — see apps/web/src/lib/imageUpload.ts — but this raises
  // the ceiling generously rather than relying on that alone).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  console.log(`resopatch API listening on http://localhost:${port}`);
}

bootstrap();
