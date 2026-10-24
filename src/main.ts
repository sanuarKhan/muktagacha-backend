import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  // Product/shop photos come in as base64 data URLs (compressed client-side
  // before upload, see lib/image-upload.ts on the frontend) - the default
  // Express/NestJS body limit (100kb) is far too small for an image, even a
  // compressed one. 8mb covers a compressed photo with comfortable headroom.
  app.use(json({ limit: '8mb' }));
  // Frontend runs on a separate origin (Vercel in production, a different
  // local port in dev) — needs explicit CORS or the browser blocks every
  // request even though curl/server-to-server calls work fine.
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
