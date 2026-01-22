import { Injectable } from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtém o histórico de compras de um usuário
   * @param userId ID do usuário
   */
  async findUserHistory(userId: string) {
    return await this.prisma.sale.findMany({
      where: {
        reservation: {
          userId,
          status: ReservationStatus.CONFIRMED,
        },
      },
      include: {
        reservation: {
          include: {
            seat: {
              include: { session: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
