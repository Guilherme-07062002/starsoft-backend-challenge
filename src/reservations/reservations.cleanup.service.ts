import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

@Injectable()
export class ReservationsCleanupService {
  private readonly logger = new Logger(ReservationsCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly amqpConnection: AmqpConnection
  ) {}

  // Roda a cada 5 segundos
  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleCron() {
    // 1. Encontra reservas que são PENDING e já venceram (expiresAt < Agora)
    const expiredReservations = await this.prisma.reservation.findMany({
      where: {
        status: 'PENDING',
        expiresAt: {
          lt: new Date(), // "Less Than" (Menor que) agora
        },
      },
      include: { seat: true },
    });

    if (expiredReservations.length === 0) {
      return; // Nada para limpar
    }

    this.logger.log(`Encontradas ${expiredReservations.length} reservas expiradas. Limpando...`);

    // 2. Processa o cancelamento
    for (const reservation of expiredReservations) {
      // Atualiza no Banco
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: 'CANCELLED' },
      });

      // 3. (Opcional) Publica evento de cancelamento
      // Útil se você tiver um dashboard de Analytics em tempo real
      this.amqpConnection.publish('cinema_events', 'reservation.expired', {
        reservationId: reservation.id,
        seatId: reservation.seatId,
        reason: 'TIMEOUT',
        timestamp: new Date().toISOString(),
      });
      
      this.logger.log(`Reserva ${reservation.id} cancelada por inatividade.`);
    }
  }
}