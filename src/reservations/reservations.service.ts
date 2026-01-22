import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateReservationDto } from './dto/reservations.dtos';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationAction } from './actions/create-reservation.action';
import { ConfirmPaymentAction } from './actions/confirm-payment.action';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createReservationAction: CreateReservationAction,
    private readonly confirmPaymentAction: ConfirmPaymentAction,
  ) {}

  async create(data: CreateReservationDto, idempotencyKey?: string) {
    return await this.createReservationAction.execute(data, idempotencyKey);
  }

  async confirmPayment(reservationId: string) {
    return await this.confirmPaymentAction.execute(reservationId);
  }

  async findByUser(userId: string) {
    return await this.prisma.reservation.findMany({
      where: { userId },
    });
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: {
        seat: {
          include: {
            session: true,
          },
        },
        sale: true,
      },
    });

    if (!reservation) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    return reservation;
  }

  async findAll() {
    return await this.prisma.reservation.findMany();
  }
}
