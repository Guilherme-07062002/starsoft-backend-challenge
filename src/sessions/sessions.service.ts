import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSessionDto, UpdateSessionDto } from './dto/sessions.dtos';
import { PrismaService } from 'src/prisma/prisma.service';
import { SeatStatus } from '@prisma/client';
import Redis from 'ioredis';

@Injectable()
export class SessionsService {
  constructor (
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async create(data: CreateSessionDto) {
    const rowsCount = data.rowsCount ?? 5;
    const seatsPerRow = data.seatsPerRow ?? 5;

    if (rowsCount > 26) {
      throw new BadRequestException('A quantidade máxima de fileiras é 26 (A-Z).');
    }

    const totalSeats = rowsCount * seatsPerRow;
    if (totalSeats < 16) {
      throw new BadRequestException('Uma sessão deve ter no mínimo 16 assentos.');
    }

    // Usamos transaction para garantir: Ou cria SESSÃO + ASSENTOS, ou não cria nada.
    return await this.prisma.$transaction(async (tx) => {
      // 1. Cria a Sessão
      const session = await tx.session.create({
        data: {
          movieId: data.movieId,
          room: data.room,
          startsAt: new Date(data.startsAt),
          price: data.price,
        },
      });

      // 2. Gera Assentos
      const rows = Array.from({ length: rowsCount }, (_, i) => String.fromCharCode(65 + i));
      const seatsToCreate = [];

      for (const row of rows) {
        for (let number = 1; number <= seatsPerRow; number++) {
          seatsToCreate.push({
            sessionId: session.id,
            row: row,
            number: number,
            status: SeatStatus.AVAILABLE, // Todos começam disponíveis
          });
        }
      }

      // 3. Insert em massa (Performance extrema)
      await tx.seat.createMany({
        data: seatsToCreate,
      });

      return session;
    });
  }

  async findAll() {
    return this.prisma.session.findMany({
      include: { seats: { orderBy: { number: 'asc' } } },
    });
  }

  // 👇 O NOVO MÉTODO DE TEMPO REAL
  async findOne(id: string) {
    // 1. Busca Sessão e Assentos no Banco (Fonte de Verdade Persistente)
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { 
        seats: { orderBy: { row: 'asc' } } 
      },
    });

    if (!session) throw new NotFoundException('Sessão não encontrada');

    // 2. Separa apenas os assentos que o banco diz estarem "LIVRES"
    // (Não precisamos checar Redis para os que já são SOLD)
    const availableSeats = session.seats.filter(s => s.status === SeatStatus.AVAILABLE);

    if (availableSeats.length > 0) {
      // 3. Otimização MGET: Busca todos os locks de uma vez só no Redis (O(1) request)
      const keys = availableSeats.map(seat => `lock:seat:${seat.id}`);
      
      // Retorna array de valores: [null, "userId-1", null, "userId-2"...]
      const locks = await this.redis.mget(keys);

      // 4. Cria um Set com os IDs que estão travados para busca rápida O(1)
      const lockedSeatIds = new Set<string>();
      
      locks.forEach((lockValue, index) => {
        if (lockValue) {
          // Se tem valor, pega o ID do assento correspondente na lista original
          lockedSeatIds.add(availableSeats[index].id);
        }
      });

      // 5. Mapeia a resposta final alterando o status visualmente
      const seatsWithRealTimeStatus = session.seats.map(seat => {
        // Se o banco diz AVAILABLE, mas o Redis diz que tem lock...
        if (seat.status === SeatStatus.AVAILABLE && lockedSeatIds.has(seat.id)) {
          return {
            ...seat,
            status: SeatStatus.LOCKED, // Marca como LOCKED para o cliente
          };
        }
        return seat;
      });

      // Retorna o objeto modificado
      return { ...session, seats: seatsWithRealTimeStatus };
    }

    // Se não tinha assentos livres ou Redis vazio, retorna original
    return session;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(id: number, updateSessionDto: UpdateSessionDto) {
    return `This action updates a #${id} session`;
  }

  remove(id: number) {
    return `This action removes a #${id} session`;
  }
}
