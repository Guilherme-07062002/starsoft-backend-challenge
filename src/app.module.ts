import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { ReservationsModule } from './reservations/reservations.module';
import { RedisModule } from './redis/redis.module';
import { MessagingModule } from './rabbitmq/rabbitmq.module';

@Module({
  imports: [
    PrismaModule,
    SessionsModule,
    ReservationsModule,
    RedisModule,
    MessagingModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
