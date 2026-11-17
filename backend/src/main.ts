import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  if (!process.env.JWT_SECRET) {
    throw new Error('Thiếu biến môi trường JWT_SECRET');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  // Sau nginx (1 lớp proxy): lấy IP máy khách từ X-Forwarded-For để audit log và giới hạn tốc độ dùng IP thật.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Main').log(`Backend chạy ở cổng ${port}`);
}

bootstrap();
