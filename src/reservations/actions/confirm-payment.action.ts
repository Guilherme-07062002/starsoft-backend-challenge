import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Reservation,
  ReservationStatus,
  SeatStatus,
} from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';

// Define o tipo exato com os includes
type ReservationWithSession = Prisma.ReservationGetPayload<{
  include: { seat: { include: { session: true } } };
}>;

@Injectable()
export class ConfirmPaymentAction {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly amqpConnection: AmqpConnection,
  ) {}

  async execute(reservationId: string) {
    const now = new Date();
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { seat: { include: { session: true } } },
    });

    await this.ensureReservationIsPayable(reservation);

    const transaction = await this.prisma.$transaction(async (tx) => {
      await this.confirmReservation(tx, reservation, now);

      await this.updateSeatsToSold(tx, reservation);

      return this.upsertSaleRecord(tx, reservation);
    });

    const result = transaction.reservation;

    if (transaction.confirmedNow) {
      await this.sendEventPaymentConfirmed(reservation, result);
    }

    await this.redis.del(`lock:seat:${reservation.seatId}`);

    return {
      message: 'Pagamento confirmado! Bom filme.',
      reservation: result,
    };
  }

  private async ensureReservationIsPayable(reservation: Reservation | null) {
    const now = new Date();
    if (!reservation) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    if (reservation.status === ReservationStatus.CONFIRMED) {
      throw new ConflictException('Pagamento já confirmado para esta reserva.');
    }

    if (reservation.status === ReservationStatus.CANCELLED) {
      throw new BadRequestException(
        'Esta reserva já foi cancelada ou expirou.',
      );
    }

    await this.expiredReservationsCleanup(reservation, now);
  }

  private async expiredReservationsCleanup(
    reservation: Reservation,
    now: Date,
  ) {
    if (now > reservation.expiresAt) {
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.CANCELLED },
      });
      throw new BadRequestException('Tempo de reserva expirado.');
    }
  }

  private async confirmReservation(
    tx: Prisma.TransactionClient,
    reservation: Reservation,
    now: Date,
  ) {
    const confirmAttempt = await tx.reservation.updateMany({
      where: {
        id: reservation.id,
        status: ReservationStatus.PENDING,
        expiresAt: { gte: now },
      },
      data: { status: ReservationStatus.CONFIRMED },
    });

    if (confirmAttempt.count === 0) {
      const latest = await tx.reservation.findUnique({
        where: { id: reservation.id },
      });

      this.checkReservationStatusForUpdate(latest);

      // Em caso de corrida ou inconsistência, falha de forma segura
      throw new ConflictException(
        'Não foi possível confirmar o pagamento (reserva já processada).',
      );
    }
  }

  private async updateSeatsToSold(
    tx: Prisma.TransactionClient,
    reservation: Reservation,
  ) {
    const seatSold = await tx.seat.updateMany({
      where: {
        id: reservation.seatId,
        status: SeatStatus.AVAILABLE,
      },
      data: {
        status: SeatStatus.SOLD,
      },
    });

    if (seatSold.count === 0) {
      throw new ConflictException('Assento já foi vendido.');
    }
  }

  private async upsertSaleRecord(
    tx: Prisma.TransactionClient,
    reservation: ReservationWithSession,
  ) {
    await tx.sale.upsert({
      where: { reservationId: reservation.id },
      create: {
        reservationId: reservation.id,
        amount: reservation.seat.session.price,
      },
      update: {},
    });

    const updated = await tx.reservation.findUnique({
      where: { id: reservation.id },
    });

    if (!updated) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    return { reservation: updated, confirmedNow: true };
  }

  private checkReservationStatusForUpdate(reservation: Reservation | null) {
    if (!reservation) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    if (reservation?.status === ReservationStatus.CONFIRMED) {
      return { reservation, confirmedNow: false };
    }

    if (reservation?.status === ReservationStatus.CANCELLED) {
      throw new BadRequestException(
        'Esta reserva já foi cancelada ou expirou.',
      );
    }
  }

  private async sendEventPaymentConfirmed(
    reservation: ReservationWithSession,
    result: Reservation,
  ) {
    const sessionPrice = reservation.seat.session.price;
    await this.amqpConnection.publish(
      'cinema_events',
      'payment.confirmed',
      {
        reservationId: result.id,
        userId: result.userId,
        seatId: reservation.seatId,
        amount: sessionPrice.toString(),
        timestamp: new Date().toISOString(),
      },
      { persistent: true },
    );
  }
}
