import Redis from 'ioredis';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateReservationDto } from '../dto/reservations.dtos';
import { PrismaService } from '../../prisma/prisma.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Seat, SeatStatus } from '@prisma/client';

@Injectable()
export class CreateReservationAction {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly amqpConnection: AmqpConnection,
  ) {}

  async execute(dto: CreateReservationDto, idempotencyKey?: string) {
    const { seatIds, userId } = dto;
    const normalizedIdemKey = this.normalizeIdempotencyKey(idempotencyKey);
    const idemCacheKey = this.normalizeIdemCacheKey(normalizedIdemKey, userId);

    if (idemCacheKey) {
      const cachedResponse = await this.checkExistingCacheKey(idemCacheKey);
      if (cachedResponse) return cachedResponse;
    }
    let acquiredLocks: string[] = [];

    try {
      const sortedSeatIds = [...seatIds].sort();
      const seats = await this.prisma.seat.findMany({
        where: {
          id: { in: sortedSeatIds },
        },
      });

      await this.validateSeatsAvailability(seats, sortedSeatIds);

      const TTL = 30000;
      acquiredLocks = await this.lockSeats(sortedSeatIds, userId, TTL);

      const expiresAt = new Date(Date.now() + TTL);

      const reservations = await this.createReservations(
        sortedSeatIds,
        userId,
        expiresAt,
      );

      await Promise.all(
        reservations.map((res) => this.emitReservationCreatedEvent(res)),
      );

      const response = {
        message: 'Reservas realizadas com sucesso!',
        reservationIds: reservations.map((r) => r.id),
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds: 30,
      };

      if (idemCacheKey) {
        await this.saveIdemResponseCache(idemCacheKey, response);
      }

      return response;
    } catch (error) {
      if (idemCacheKey) {
        await this.redis.del(idemCacheKey);
      }
      if (acquiredLocks.length > 0) {
        await this.redis.del(...acquiredLocks);
      }
      throw error;
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeIdempotencyKey(value?: string) {
    if (!value) return undefined;

    const trimmed = value.trim();
    if (!trimmed) return undefined;

    return trimmed.slice(0, 128);
  }

  private normalizeIdemCacheKey(normalizedIdemKey?: string, userId?: string) {
    if (!userId || !normalizedIdemKey) return undefined;

    return normalizedIdemKey
      ? `idem:reservation:${userId}:${normalizedIdemKey}`
      : undefined;
  }

  private async checkExistingCacheKey(idemCacheKey: string) {
    const existing = await this.redis.get(idemCacheKey);
    if (existing) {
      const isProcessing = await this.checkIfIdemCacheKeyIsProcessing(
        existing,
        idemCacheKey,
      );
      if (isProcessing) return isProcessing;
    }

    const processing = await this.markIdemCacheKeyAsProcessing(idemCacheKey);
    return processing;
  }

  async checkIfIdemCacheKeyIsProcessing(
    cachedValue: string,
    idemCacheKey: string,
  ) {
    const parsed = JSON.parse(cachedValue);
    if (parsed?.status === 'processing') {
      for (let i = 0; i < 15; i++) {
        await this.sleep(100);
        const retry = await this.redis.get(idemCacheKey);
        if (retry) {
          const retryParsed = JSON.parse(retry);
          if (retryParsed?.status !== 'processing') return retryParsed;
        }
      }
      throw new ConflictException(
        'Requisição idempotente em processamento. Tente novamente.',
      );
    }

    return parsed;
  }

  async markIdemCacheKeyAsProcessing(idemCacheKey: string) {
    const claimed = await this.redis.set(
      idemCacheKey,
      JSON.stringify({ status: 'processing' }),
      'PX',
      60000,
      'NX',
    );

    if (!claimed) {
      const retry = await this.redis.get(idemCacheKey);
      if (retry) return JSON.parse(retry);

      throw new ConflictException('Requisição idempotente em processamento.');
    }
  }

  async validateSeatsAvailability(seats: Seat[], sortedSeatIds: string[]) {
    // Validações básicas
    if (seats.length !== sortedSeatIds.length) {
      throw new NotFoundException('Um ou mais assentos não foram encontrados.');
    }

    // Verifica se algum já está vendido ou reservado
    const soldSeats = seats.filter((s) => s.status !== SeatStatus.AVAILABLE);
    if (soldSeats.length > 0) {
      if (soldSeats.length === 1) {
        throw new ConflictException(
          `O assento ${soldSeats[0].number} já foi reservado.`,
        );
      } else {
        throw new ConflictException(
          `Os assentos ${soldSeats.map((s) => s.number).join(', ')} já foram reservados.`,
        );
      }
    }
  }

  async lockSeats(seatIds: string[], userId: string, TTL: number) {
    const acquiredLocks: string[] = [];
    try {
      for (const seatId of seatIds) {
        const lockKey = `lock:seat:${seatId}`;
        const acquired = await this.redis.set(lockKey, userId, 'PX', TTL, 'NX');

        if (!acquired) {
          // Se falhou, faz rollback dos anteriores e aborta
          throw new ConflictException(
            `O assento ${seatId} acabou de ser reservado por outro usuário.`,
          );
        }
        acquiredLocks.push(lockKey);
      }
      return acquiredLocks;
    } catch (error) {
      // ROLLBACK DOS LOCKS (Se pegou 2 de 3, solta os 2)
      if (acquiredLocks.length > 0) {
        await this.redis.del(...acquiredLocks);
      }
      throw error;
    }
  }

  async createReservations(
    sortedSeatIds: string[],
    userId: string,
    expiresAt: Date,
  ) {
    const reservations = await this.prisma.$transaction(
      sortedSeatIds.map((seatId) =>
        this.prisma.reservation.create({
          data: {
            seatId,
            userId,
            status: 'PENDING',
            expiresAt,
          },
        }),
      ),
    );
    return reservations;
  }

  async emitReservationCreatedEvent(reservation: any) {
    await this.amqpConnection.publish(
      'cinema_events',
      'reservation.created',
      { ...reservation },
      { persistent: true },
    );
  }

  async saveIdemResponseCache(idemCacheKey: string, response: any) {
    await this.redis.set(idemCacheKey, JSON.stringify(response), 'PX', 60000);
  }
}
