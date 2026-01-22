import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsCleanupService } from './reservations.cleanup.service';
import { CreateReservationAction } from './actions/create-reservation.action';
import { ConfirmPaymentAction } from './actions/confirm-payment.action';

@Module({
  controllers: [ReservationsController],
  providers: [
    ReservationsService,
    ReservationsCleanupService,
    CreateReservationAction,
    ConfirmPaymentAction,
  ],
})
export class ReservationsModule {}
