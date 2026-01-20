import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateReservationDto, UpdateReservationDto } from './dto/reservation.dtos';
import { PrismaService } from 'src/prisma/prisma.service';
import Redis from 'ioredis';
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
    const { seatId, userId } = dto;

    // 1. Verificar se o assento existe no banco (Sanity Check)
    const seat = await this.prisma.seat.findUnique({
      where: { id: seatId },
    });

    if (!seat) throw new NotFoundException('Assento não encontrado');

    if (seat.status !== SeatStatus.AVAILABLE) throw new ConflictException('Este assento já foi vendido definitivamente.');

    // 2. TENTATIVA DE LOCK NO REDIS
    // Chave única por assento. TTL de 30 segundos (30000ms).
    const lockKey = `lock:seat:${seatId}`;
    
    // O comando SET com 'NX' (Not Exists) é atômico.
    // Retorna 'OK' se conseguiu criar. Retorna null se já existia.
    const acquiredLock = await this.redis.set(lockKey, userId, 'PX', 30000, 'NX');

    if (!acquiredLock) {
      // SE CAIR AQUI: Race Condition evitada! 
      // Alguém clicou 1 milissegundo antes.
      throw new ConflictException('Assento reservado por outro usuário. Tente novamente em 30s.');
    }

    // 3. Se conseguiu o lock, cria a reserva no Postgres
    try {
      const reservation = await this.prisma.reservation.create({
        data: {
          seatId: seatId,
          userId: userId,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 30000), // Expira em 30s
        },
      });

      return {
        message: 'Reserva temporária realizada com sucesso!',
        reservationId: reservation.id,
        expiresInSeconds: 30,
      };
    } catch (error) {
      // Rollback manual do Redis se o banco falhar (muito raro, mas boa prática)
      await this.redis.del(lockKey);
      throw error;
    }
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
