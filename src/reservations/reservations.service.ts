import Redis from 'ioredis';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateReservationDto, UpdateReservationDto } from './dto/reservations.dtos';
import { PrismaService } from 'src/prisma/prisma.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ReservationStatus, SeatStatus } from '@prisma/client';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly amqpConnection: AmqpConnection,
  ) {}

  async create(dto: CreateReservationDto) {
    const { seatIds, userId } = dto;

    // 1. ORDENAÇÃO PARA EVITAR DEADLOCK (Critical Path)
    // Se User A pede [1, 2] e User B pede [2, 1], ambos tentarão lockar 1 primeiro.
    const sortedSeatIds = [...seatIds].sort(); 

    // 2. Validação no Banco (Existe? Está Disponível?)
    // Buscamos todos de uma vez
    const seats = await this.prisma.seat.findMany({
      where: { 
        id: { in: sortedSeatIds } 
      }
    });

    // Validações básicas
    if (seats.length !== sortedSeatIds.length) {
      throw new NotFoundException('Um ou mais assentos não foram encontrados.');
    }

    const soldSeats = seats.filter(s => s.status !== SeatStatus.AVAILABLE);
    if (soldSeats.length > 0) {
      throw new ConflictException(`Os assentos ${soldSeats.map(s => s.number).join(', ')} já foram vendidos.`);
    }

    // 3. TENTATIVA DE LOCK NO REDIS (Iterativa)
    const acquiredLocks: string[] = [];
    const TTL = 30000; // 30s

    try {
      for (const seatId of sortedSeatIds) {
        const lockKey = `lock:seat:${seatId}`;
        const acquired = await this.redis.set(lockKey, userId, 'PX', TTL, 'NX');

        if (!acquired) {
          // Falhou no meio do caminho? Aborta tudo!
          throw new ConflictException(`O assento ${seatId} acabou de ser reservado por outro usuário.`);
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

    // 4. Se chegou aqui, todos os locks são nossos. Cria no Postgres.
    // Precisamos de um ID de reserva único para o grupo ou reservas individuais?
    // O requisito diz "Retornar ID da reserva". Geralmente é um "Order ID" ou cria várias reservas.
    // Vamos criar várias reservas (uma por assento) mas retornar um Group ID seria ideal.
    // Para simplificar e manter compatibilidade com seu schema atual, vamos criar N reservas.
    
    const expiresAt = new Date(Date.now() + TTL);

    // Usamos transaction para garantir que todas gravam
    const reservations = await this.prisma.$transaction(
      sortedSeatIds.map(seatId => 
        this.prisma.reservation.create({
          data: {
            seatId,
            userId,
            status: 'PENDING',
            expiresAt,
          }
        })
      )
    );

    // 5. Publicar Evento (Resolvendo lacuna 3)
    // Como são várias, podemos publicar um evento de "BatchReserved" ou loop.
    // Vamos no simples: Loop
    reservations.forEach(res => {
      this.amqpConnection.publish('cinema_events', 'reservation.created', { ...res }); 
    });

    return {
      message: 'Reservas realizadas com sucesso!',
      // Retorna lista de IDs
      reservationIds: reservations.map(r => r.id), 
      // Resolvendo lacuna 2.2: Retornar timestamp explícito
      expiresAt: expiresAt.toISOString(), 
      expiresInSeconds: 30,
    };
  }

  async confirmPayment(reservationId: string) {
    // 1. Busca a reserva
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { seat: true },
    });

    if (!reservation) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    // 2. Validações de Regra de Negócio
    if (reservation.status === ReservationStatus.CONFIRMED) {
      return { message: 'Pagamento já foi processado anteriormente.' };
    }

    if (reservation.status === ReservationStatus.CANCELLED) {
      throw new BadRequestException('Esta reserva já foi cancelada ou expirou.');
    }

    // Verifica se já passou do tempo de expiração do banco
    if (new Date() > reservation.expiresAt) {
      // Opcional: Já marca como cancelada se estiver vencida
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CANCELLED },
      });
      throw new BadRequestException('Tempo de reserva expirado.');
    }

    // 3. Transação: Confirma Reserva E Marca Assento como Vendido
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedReservation = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'CONFIRMED' },
      });

      await tx.seat.update({
        where: { id: reservation.seatId },
        data: { status: SeatStatus.SOLD }, // Isso impede que o assento volte a ficar livre
      });

      return updatedReservation;
    });

    // 4. Publica Evento no RabbitMQ (Fire and Forget)
    // Routing Key: "payment.confirmed"
    this.amqpConnection.publish('cinema_events', 'payment.confirmed', {
      reservationId: result.id,
      userId: result.userId,
      seatId: reservation.seatId,
      amount: 25.50, // Num cenário real, viria da sessão
      timestamp: new Date().toISOString(),
    });
    
    // Limpeza Opcional: Remove o Lock do Redis antecipadamente já que vendeu
    await this.redis.del(`lock:seat:${reservation.seatId}`);

    return {
      message: 'Pagamento confirmado! Bom filme.',
      reservation: result,
    };
  }

  // Apenas para listar e verificarmos
  findAll() {
    return this.prisma.reservation.findMany();
  }

  findOne(id: number) {
    return `This action returns a #${id} reservation`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(id: number, updateReservationDto: UpdateReservationDto) {
    return `This action updates a #${id} reservation`;
  }

  remove(id: number) {
    return `This action removes a #${id} reservation`;
  }
}
