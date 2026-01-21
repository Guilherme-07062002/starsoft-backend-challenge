import Redis from 'ioredis';
import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { ReservationStatus } from '@prisma/client';

/**
 * Serviço responsável por limpar reservas expiradas periodicamente.
 * Ele verifica reservas no status PENDING que já passaram do tempo de expiração,
 * cancela essas reservas, libera os assentos correspondentes e publica eventos
 * relevantes no RabbitMQ.
 */
@Injectable()
export class ReservationsCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly amqpConnection: AmqpConnection,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReservationsCleanupService.name);
  }

  /**
   * Libera o lock distribuído no Redis
   * @param lockKey Chave do lock no Redis
   * @param token Token que identifica o lock adquirido
   */
  private async releaseLock(lockKey: string, token: string) {
    // Libera apenas se o token for o mesmo (evita soltar lock de outra instância)
    const script =
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

    await this.redis.eval(script, 1, lockKey, token);
  }

  /**
   * Tarefa cron que roda a cada 5 segundos para limpar reservas expiradas.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleCron() {
    // Evita múltiplas instâncias processarem a mesma expiração ao mesmo tempo
    const lockKey = 'lock:cron:reservations-cleanup';
    const token = randomUUID();
    const acquired = await this.redis.set(lockKey, token, 'PX', 4500, 'NX');

    // Se não conseguiu o lock, outra instância está processando
    if (!acquired) return;

    const now = new Date();

    // 1. Encontra reservas que são PENDING e já venceram (expiresAt < Agora)
    try {
      const expiredReservations = await this.prisma.reservation.findMany({
        where: {
          status: ReservationStatus.PENDING,
          expiresAt: {
            lt: now, // "Less Than" (Menor que) agora
          },
        },
        include: { seat: true },
      });

      if (expiredReservations.length === 0) {
        return; // Nada para limpar
      }

      this.logger.info(
        `Encontradas ${expiredReservations.length} reservas expiradas. Limpando...`,
      );

      // 2. Processa o cancelamento (idempotente)
      for (const reservation of expiredReservations) {
        const cancelled = await this.prisma.reservation.updateMany({
          where: {
            id: reservation.id,
            status: ReservationStatus.PENDING,
            expiresAt: { lt: now },
          },
          data: { status: ReservationStatus.CANCELLED },
        });

        // Outra instância já processou
        if (cancelled.count === 0) continue;

        const timestamp = new Date().toISOString();

        // 3. Publica evento de cancelamento
        this.amqpConnection.publish(
          'cinema_events',
          'reservation.expired',
          {
            reservationId: reservation.id,
            seatId: reservation.seatId,
            reason: 'TIMEOUT',
            timestamp,
          },
          { persistent: true },
        );

        // 4. Remove lock e publica evento explícito de assento liberado
        await this.redis.del(`lock:seat:${reservation.seatId}`);

        this.amqpConnection.publish(
          'cinema_events',
          'seat.released',
          {
            seatId: reservation.seatId,
            reservationId: reservation.id,
            reason: 'RESERVATION_EXPIRED',
            timestamp,
          },
          { persistent: true },
        );

        this.logger.info(
          `Reserva ${reservation.id} cancelada por inatividade.`,
        );
      }
    } finally {
      await this.releaseLock(lockKey, token);
    }
  }
}
