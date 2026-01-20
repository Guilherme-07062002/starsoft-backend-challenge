import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateReservationDto, UpdateReservationDto } from './dto/reservation.dtos';
import { PrismaService } from 'src/prisma/prisma.service';
import Redis from 'ioredis';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis
  ) {}

  async create(dto: CreateReservationDto) {
    const { seatId, userId } = dto;

    // 1. Verificar se o assento existe no banco (Sanity Check)
    const seat = await this.prisma.seat.findUnique({
      where: { id: seatId },
    });

    if (!seat) throw new NotFoundException('Assento não encontrado');

    if (seat.status !== 'AVAILABLE') throw new ConflictException('Este assento já foi vendido definitivamente.');

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
