import Redis from 'ioredis';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateReservationDto } from '../dto/reservations.dtos';
import { PrismaService } from 'src/prisma/prisma.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { SeatStatus } from '@prisma/client';

@Injectable()
export class CreateReservationAction {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly amqpConnection: AmqpConnection,
  ) {}

  /**
   * Pausa a execução por um determinado número de milissegundos.
   * @param ms Número de milissegundos para pausar.
   * @returns Uma Promise que resolve após o tempo especificado.
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Normaliza a chave de idempotência removendo espaços e limitando o tamanho.
   * @param value Chave de idempotência fornecida.
   * @returns Chave normalizada ou undefined se inválida.
   */
  private normalizeIdempotencyKey(value?: string) {
    if (!value) return undefined;

    const trimmed = value.trim();
    if (!trimmed) return undefined;

    // Evita chaves gigantes (proteção básica)
    return trimmed.slice(0, 128);
  }

  /**
   * Cria uma nova reserva de assento.
   * @param dto Dados para criação da reserva.
   * @param idempotencyKey Chave de idempotência opcional para evitar duplicação.
   * @returns Detalhes da reserva criada.
   */
  async execute(dto: CreateReservationDto, idempotencyKey?: string) {
    const { seatIds, userId } = dto;

    // Normaliza a chave de idempotência
    const normalizedIdemKey = this.normalizeIdempotencyKey(idempotencyKey);
    const idemCacheKey = normalizedIdemKey
      ? `idem:reservation:${userId}:${normalizedIdemKey}`
      : undefined;

    // Idempotência: se já existe uma resposta para essa chave, retorna igual.
    if (idemCacheKey) {
      const existing = await this.redis.get(idemCacheKey);
      if (existing) {
        const parsed = JSON.parse(existing);
        if (parsed?.status === 'processing') {
          // Espera curto período para a requisição original completar
          for (let i = 0; i < 15; i++) {
            // Aguarda 100ms
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

      // Marca como "processing" com TTL; apenas 1 instância deve executar o fluxo.
      const claimed = await this.redis.set(
        idemCacheKey,
        JSON.stringify({ status: 'processing' }),
        'PX',
        60000, // 1 minuto
        'NX',
      );

      if (!claimed) {
        // Alguém acabou de criar; tenta ler de novo
        const retry = await this.redis.get(idemCacheKey);
        if (retry) return JSON.parse(retry);
        throw new ConflictException('Requisição idempotente em processamento.');
      }
    }

    try {
      // 1. ORDENAÇÃO PARA EVITAR DEADLOCK (Critical Path)
      // Se User A pede [1, 2] e User B pede [2, 1], ambos tentarão lockar 1 primeiro.
      const sortedSeatIds = [...seatIds].sort();

      // 2. Validação no Banco (Existe? Está Disponível?)
      // Buscamos todos de uma vez
      const seats = await this.prisma.seat.findMany({
        where: {
          id: { in: sortedSeatIds },
        },
      });

      // Validações básicas
      if (seats.length !== sortedSeatIds.length) {
        throw new NotFoundException(
          'Um ou mais assentos não foram encontrados.',
        );
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

      // 3. TENTATIVA DE LOCK NO REDIS (Iterativa)
      const acquiredLocks: string[] = [];
      const TTL = 30000; // 30s

      try {
        for (const seatId of sortedSeatIds) {
          const lockKey = `lock:seat:${seatId}`;
          const acquired = await this.redis.set(
            lockKey,
            userId,
            'PX',
            TTL,
            'NX',
          );

          if (!acquired) {
            // Se falhou, faz rollback dos anteriores e aborta
            throw new ConflictException(
              `O assento ${seatId} acabou de ser reservado por outro usuário.`,
            );
          }
          acquiredLocks.push(lockKey);
        }
      } catch (error) {
        // ROLLBACK DOS LOCKS (Se pegou 2 de 3, solta os 2)
        if (acquiredLocks.length > 0) {
          await this.redis.del(...acquiredLocks);
        }
        throw error;
      }

      // 4. Criação das Reservas no Banco
      const expiresAt = new Date(Date.now() + TTL);

      // Transação para criar todas as reservas garantindo atomicidade
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

      // 5. Publicar Evento de Reserva Criada para cada reserva
      reservations.forEach((res) => {
        this.amqpConnection.publish(
          'cinema_events',
          'reservation.created',
          { ...res },
          { persistent: true },
        );
      });

      const response = {
        message: 'Reservas realizadas com sucesso!',
        reservationIds: reservations.map((r) => r.id), // Lista de IDs das reservas
        expiresAt: expiresAt.toISOString(), // Retorna quando expira
        expiresInSeconds: 30,
      };

      if (idemCacheKey) {
        await this.redis.set(
          idemCacheKey,
          JSON.stringify(response),
          'PX',
          60000,
        );
      }

      return response;
    } catch (error) {
      if (idemCacheKey) {
        await this.redis.del(idemCacheKey);
      }
      throw error;
    }
  }
}
