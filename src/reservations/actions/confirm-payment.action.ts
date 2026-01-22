import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReservationStatus, SeatStatus } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ConfirmPaymentAction {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly amqpConnection: AmqpConnection,
  ) {}

  async execute(reservationId: string) {
    const now = new Date();

    // 1. Busca a reserva
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { seat: { include: { session: true } } },
    });

    if (!reservation) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    // 2. Validações de Regra de Negócio
    if (reservation.status === ReservationStatus.CONFIRMED) {
      return { message: 'Pagamento já foi processado anteriormente.' };
    }

    if (reservation.status === ReservationStatus.CANCELLED) {
      throw new BadRequestException(
        'Esta reserva já foi cancelada ou expirou.',
      );
    }

    // Verifica se já passou do tempo de expiração do banco
    if (now > reservation.expiresAt) {
      // Opcional: Já marca como cancelada se estiver vencida
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CANCELLED },
      });
      throw new BadRequestException('Tempo de reserva expirado.');
    }

    // 3. Transação: Confirma Reserva E Marca Assento como Vendido
    // Observação: usamos updateMany para garantir consistência sob concorrência.
    const txResult = await this.prisma.$transaction(async (tx) => {
      const confirmAttempt = await tx.reservation.updateMany({
        where: {
          id: reservationId,
          status: ReservationStatus.PENDING,
          expiresAt: { gte: now },
        },
        data: { status: ReservationStatus.CONFIRMED },
      });

      if (confirmAttempt.count === 0) {
        const latest = await tx.reservation.findUnique({
          where: { id: reservationId },
        });

        if (latest?.status === ReservationStatus.CONFIRMED) {
          return { reservation: latest, confirmedNow: false };
        }

        if (latest?.status === ReservationStatus.CANCELLED) {
          throw new BadRequestException(
            'Esta reserva já foi cancelada ou expirou.',
          );
        }

        // Em caso de corrida ou inconsistência, falha de forma segura
        throw new ConflictException(
          'Não foi possível confirmar o pagamento (reserva já processada).',
        );
      }

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
        // Se o assento já não está AVAILABLE, aborta para evitar inconsistência
        throw new ConflictException('Assento já foi vendido.');
      }

      // Cria/garante registro de venda (idempotência)
      await tx.sale.upsert({
        where: { reservationId },
        create: {
          reservationId,
          amount: reservation.seat.session.price,
        },
        update: {},
      });

      const updated = await tx.reservation.findUnique({
        where: { id: reservationId },
      });

      if (!updated) {
        throw new NotFoundException('Reserva não encontrada.');
      }

      return { reservation: updated, confirmedNow: true };
    });

    const result = txResult.reservation;

    // 4. Publica Evento no RabbitMQ (Fire and Forget)
    // Routing Key: "payment.confirmed"
    if (txResult.confirmedNow) {
      const sessionPrice = reservation.seat.session.price;
      this.amqpConnection.publish(
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

    // Limpeza Opcional: Remove o Lock do Redis antecipadamente já que vendeu
    await this.redis.del(`lock:seat:${reservation.seatId}`);

    return {
      message: 'Pagamento confirmado! Bom filme.',
      reservation: result,
    };
  }
}
