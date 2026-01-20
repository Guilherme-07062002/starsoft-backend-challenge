import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsCleanupService } from './reservations.cleanup.service';

@Module({
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationsCleanupService],
})
export class ReservationsModule {}
