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

    try {
      // 1. Encontra IDs de reservas que são PENDING e já venceram
      const expiredReservations = await this.prisma.reservation.findMany({
        where: {
          status: ReservationStatus.PENDING,
          expiresAt: {
            lt: now, // "Less Than" (Menor que) agora
          },
        },
        select: { id: true, seatId: true, userId: true }, // Otimização: pega só o que precisa
      });

      if (expiredReservations.length === 0) {
        return; // Nada para limpar
      }

      this.logger.info(
        `Encontradas ${expiredReservations.length} reservas expiradas. Limpando em lote...`,
      );

      const reservationIds = expiredReservations.map((r) => r.id);
      const seatLockKeys = expiredReservations.map(
        (r) => `lock:seat:${r.seatId}`,
      );

      // 2. Cancela todas as reservas no banco DE UMA VEZ
      const { count } = await this.prisma.reservation.updateMany({
        where: {
          id: { in: reservationIds },
          status: ReservationStatus.PENDING, // Garante idempotência
        },
        data: { status: ReservationStatus.CANCELLED },
      });

      // Se count for 0, outra instância já processou.
      if (count === 0) {
        this.logger.info('Reservas já processadas por outra instância.');
        return;
      }

      // 3. Remove todos os locks do Redis DE UMA VEZ
      if (seatLockKeys.length > 0) {
        await this.redis.del(seatLockKeys);
      }

      const timestamp = new Date().toISOString();

      // 4. Publica os eventos (ainda em loop, mas as operações pesadas já foram)
      for (const reservation of expiredReservations) {
        // Publica evento de cancelamento
        this.amqpConnection.publish(
          'cinema_events',
          'reservation.expired',
          {
            reservationId: reservation.id,
            seatId: reservation.seatId,
            userId: reservation.userId,
            reason: 'TIMEOUT',
            timestamp,
          },
          { persistent: true },
        );

        // Publica evento de assento liberado
        this.amqpConnection.publish(
          'cinema_events',
          'seat.released',
          {
            seatId: reservation.seatId,
            reservationId: reservation.id,
            reason: 'RESERVATION_EXPIRED',
            userId: reservation.userId,
            timestamp,
          },
          { persistent: true },
        );
      }

      this.logger.info(
        `${count} reservas expiradas foram canceladas e seus assentos liberados.`,
      );
    } finally {
      await this.releaseLock(lockKey, token);
    }
  }
}
