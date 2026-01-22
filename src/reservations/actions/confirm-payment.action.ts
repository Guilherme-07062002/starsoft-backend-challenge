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
import { PrismaService } from '../../prisma/prisma.service';

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
    if (!reservation) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    await this.ensureReservationIsPayable(reservation);

    const transactionResult = await this.prisma.$transaction(async (tx) => {
      await this.confirmReservation(tx, reservation, now);

      await this.updateSeatsToSold(tx, reservation);

      return this.createSaleRecord(tx, reservation);
    });

    await this.sendEventPaymentConfirmed(reservation, transactionResult.saleId);

    await this.redis.del(`lock:seat:${reservation.seatId}`);

    return {
      message: 'Pagamento confirmado! Bom filme.',
      reservation: transactionResult.reservation,
    };
  }

  private async ensureReservationIsPayable(
    reservation: ReservationWithSession,
  ) {
    const now = new Date();
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
    const result = await tx.reservation.updateMany({
      where: {
        id: reservation.id,
        status: ReservationStatus.PENDING,
        expiresAt: { gte: now },
      },
      data: { status: ReservationStatus.CONFIRMED },
    });

    if (result.count === 0) {
      const current = await tx.reservation.findUnique({
        where: { id: reservation.id },
      });

      if (current?.status === ReservationStatus.CONFIRMED) {
        throw new ConflictException(
          'Reserva já foi paga processada concorrentemente.',
        );
      }

      throw new ConflictException(
        'Não foi possível confirmar (Expirada ou Cancelada).',
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

  private async createSaleRecord(
    tx: Prisma.TransactionClient,
    reservation: ReservationWithSession,
  ) {
    const sale = await tx.sale.create({
      data: {
        reservationId: reservation.id,
        amount: reservation.seat.session.price,
      },
    });

    return {
      saleId: sale.id,
      reservation: {
        ...reservation,
        status: ReservationStatus.CONFIRMED,
      },
    };
  }

  private async sendEventPaymentConfirmed(
    reservation: ReservationWithSession,
    saleId: string,
  ) {
    const sessionPrice = reservation.seat.session.price;
    await this.amqpConnection.publish(
      'cinema_events',
      'payment.confirmed',
      {
        reservationId: reservation.id,
        saleId: saleId,
        userId: reservation.userId,
        seatId: reservation.seatId,
        amount: sessionPrice.toString(),
        timestamp: new Date().toISOString(),
      },
      { persistent: true },
    );
  }
}
