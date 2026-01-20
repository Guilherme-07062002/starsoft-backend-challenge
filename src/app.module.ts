import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { ReservationsModule } from './reservations/reservations.module';
import { RedisModule } from './redis/redis.module';
import { MessagingModule } from './rabbitmq/rabbitmq.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    PrismaModule,
    SessionsModule,
    ReservationsModule,
    RedisModule,
    MessagingModule,
    ScheduleModule.forRoot(), // O forRoot inicializa o módulo de agendamento
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
