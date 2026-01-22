import Redis from 'ioredis';
import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { ReservationStatus } from '@prisma/client';

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

  private async releaseLock(lockKey: string, token: string) {
    const script =
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

    await this.redis.eval(script, 1, lockKey, token);
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleCron() {
    const lockKey = 'lock:cron:reservations-cleanup';
    const token = randomUUID();
    const acquired = await this.redis.set(lockKey, token, 'PX', 4500, 'NX');

    if (!acquired) return;

    const now = new Date();

    try {
      const expiredReservations = await this.prisma.reservation.findMany({
        where: {
          status: ReservationStatus.PENDING,
          expiresAt: {
            lt: now,
          },
        },
        select: { id: true, seatId: true, userId: true },
      });

      if (expiredReservations.length === 0) {
        return;
      }

      this.logger.info(
        `Encontradas ${expiredReservations.length} reservas expiradas. Limpando em lote...`,
      );

      const reservationIds = expiredReservations.map((r) => r.id);
      const seatLockKeys = expiredReservations.map(
        (r) => `lock:seat:${r.seatId}`,
      );

      const { count } = await this.prisma.reservation.updateMany({
        where: {
          id: { in: reservationIds },
          status: ReservationStatus.PENDING,
        },
        data: { status: ReservationStatus.CANCELLED },
      });

      if (count === 0) {
        this.logger.info('Reservas já processadas por outra instância.');
        return;
      }

      if (seatLockKeys.length > 0) {
        await this.redis.del(seatLockKeys);
      }

      const timestamp = new Date().toISOString();

      for (const reservation of expiredReservations) {
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
