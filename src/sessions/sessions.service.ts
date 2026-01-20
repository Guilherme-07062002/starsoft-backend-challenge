import { Injectable } from '@nestjs/common';
import { CreateSessionDto, UpdateSessionDto } from './dto/sessions.dtos';
import { PrismaService } from 'src/prisma/prisma.service';
import { SeatStatus } from '@prisma/client';

@Injectable()
export class SessionsService {
  constructor (private readonly prisma: PrismaService) {}

  async create(data: CreateSessionDto) {
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

      // 2. Gera Assentos (Ex: 5 fileiras de 5 cadeiras = 25 assentos)
      // O requisito pede mínimo 16. Vamos fazer 25.
      const rows = ['A', 'B', 'C', 'D', 'E'];
      const seatsToCreate = [];

      for (const row of rows) {
        for (let number = 1; number <= 5; number++) {
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
     return await this.prisma.session.findMany({
      include: { seats: true }, // Traz os assentos juntos
    });
  }

  findOne(id: number) {
    return `This action returns a #${id} session`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(id: number, updateSessionDto: UpdateSessionDto) {
    return `This action updates a #${id} session`;
  }

  remove(id: number) {
    return `This action removes a #${id} session`;
  }
}
