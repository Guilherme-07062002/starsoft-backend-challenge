import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { ReservationsModule } from './reservations/reservations.module';
import { RedisModule } from './redis/redis.module';
import { MessagingModule } from './rabbitmq/rabbitmq.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './notifications/notifications.module';
import { seconds, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { LoggerModule } from 'nestjs-pino';
import { SalesModule } from './sales/sales.module';

@Module({
  imports: [
    // Configuração do Rate Limiting, está configurado para 10 requisições por minuto por IP
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: seconds(60), // 60 segundos
          limit: 10, // 10 requisições
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
    LoggerModule.forRoot({
      pinoHttp: {
        level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
        autoLogging: false, // Opcional: Evita logar cada requisição HTTP automaticamente se achar muito verboso
        redact: ['req.headers.authorization'], // Segurança: Esconde tokens

        // Formatação customizada (Opcional)
        serializers: {
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            // user: req.raw.user?.id // Se quiser logar o ID do usuário logado
          }),
        },
      },
    }),
    PrismaModule,
    RedisModule,
    MessagingModule,

    // Features
    SessionsModule,
    ReservationsModule,
    NotificationsModule,
    SalesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard, // Usa o guard customizado para Rate Limiting
    },
  ],
})
export class AppModule {}
