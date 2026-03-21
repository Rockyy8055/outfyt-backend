import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    try {
      await this.$connect();
      console.log('[prisma] connected');
    } catch (err) {
      console.error('[prisma] connection error', err);
      throw err;
    }
  }

  async enableShutdownHooks(app: INestApplication) {
    const shutdown = async () => {
      await app.close();
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
}
