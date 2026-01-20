import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { ReservationsModule } from './reservations/reservations.module';
import { RedisModule } from './redis/redis.module';
import { MessagingModule } from './rabbitmq/rabbitmq.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './notifications/notifications.module';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';

@Module({
  imports: [
    // Configuração do Rate Limiting, está configurado para 10 requisições por minuto por IP
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: seconds(60), // 60 segundos
          limit: 10,  // 10 requisições
        },
      ],
      storage: new ThrottlerStorageRedisService({
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        // password: process.env.REDIS_PASSWORD se houver senha
      }),
    }),

    // Infra
    ScheduleModule.forRoot(), // O forRoot inicializa o módulo de agendamento
    PrismaModule,
    RedisModule,
    MessagingModule,

    // Features
    SessionsModule,
    ReservationsModule,
    NotificationsModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
