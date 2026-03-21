import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  
  // Health check endpoint for Render
  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).send('OK');
  });
  
  await app.listen(process.env.PORT || 3000, '0.0.0.0');
}
bootstrap();
