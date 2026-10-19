import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);
  // La API solo se alcanza vía nginx (contenedor no publicado); confiar en los
  // dos saltos (nginx web/store + NPM) para resolver la IP real del cliente.
  app.getHttpAdapter().getInstance().set('trust proxy', 2);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(Number(config.get('API_PORT') ?? 3000), '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'STARTUP_ERROR';
  console.error('POS API failed to start', { code });
  process.exit(1);
});
