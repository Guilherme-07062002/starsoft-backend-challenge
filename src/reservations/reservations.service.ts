import Redis from 'ioredis';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateReservationDto } from './dto/reservations.dtos';
import { PrismaService } from '../prisma/prisma.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ReservationStatus, SeatStatus } from '@prisma/client';

@Injectable()
export class ReservationsService {
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
  async create(dto: CreateReservationDto, idempotencyKey?: string) {
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

  /**
   * Confirma o pagamento de uma reserva existente.
   * @param reservationId ID da reserva a ser confirmada.
   */
  async confirmPayment(reservationId: string) {
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
