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

  /**
   * Lista todas as reservas de um usuário.
   * @param userId ID do usuário cujas reservas serão listadas.
   * @returns Lista de reservas do usuário.
   */
  async findByUser(userId: string) {
    return await this.prisma.reservation.findMany({
      where: { userId },
    });
  }

  /**
   * Obtém os detalhes de uma reserva específica.
   * @param id ID da reserva a ser obtida.
   * @returns Detalhes da reserva.
   */
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

  /**
   * Lista todas as reservas.
   * @returns Lista de todas as reservas.
   */
  async findAll() {
    return await this.prisma.reservation.findMany();
  }
}
