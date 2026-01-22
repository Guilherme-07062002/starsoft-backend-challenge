import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { HealthModule } from './health/health.module';
import {
  makeHistogramProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';
import { LoggingMetricInterceptor } from './common/interceptors/logging-metric.interceptor';

@Module({
  imports: [
    // Infra
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: seconds(60),
          limit: 10,
        },
      ],
      storage: new ThrottlerStorageRedisService({
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        // password: process.env.REDIS_PASSWORD se houver senha
      }),
    }),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
        autoLogging: false,
        redact: ['req.headers.authorization'],

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
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
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
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    // Cria a métrica personalizada
    makeHistogramProvider({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'code'],
      buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 5], // Buckets de tempo (s)
    }),
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingMetricInterceptor,
    },
  ],
})
export class AppModule {}
