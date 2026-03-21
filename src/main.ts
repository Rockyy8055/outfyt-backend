import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  
  // Health check endpoint for Render
  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).send('OK');
  });
  
  // Enable graceful shutdown hooks
  app.enableShutdownHooks();
  
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Server running on port ${port}`);
}
bootstrap();
