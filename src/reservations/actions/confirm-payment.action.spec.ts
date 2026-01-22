import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ReservationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfirmPaymentAction } from './confirm-payment.action';

const mockTx = {
  reservation: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
  },
  seat: {
    updateMany: jest.fn(),
  },
  sale: {
    create: jest.fn(),
  },
};

const mockPrismaService = {
  seat: {
    findMany: jest.fn(),
  },
  reservation: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(async (arg) => {
    if (typeof arg === 'function') {
      return arg(mockTx);
    }

    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }

    throw new Error('Formato inválido para $transaction mockado');
  }),
};

const mockRedisClient = {
  set: jest.fn(),
  del: jest.fn(),
  get: jest.fn(),
};

const mockAmqpConnection = {
  publish: jest.fn(),
};

describe('ReservationsService', () => {
  let action: ConfirmPaymentAction;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfirmPaymentAction,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedisClient,
        },
        {
          provide: AmqpConnection,
          useValue: mockAmqpConnection,
        },
      ],
    }).compile();

    action = module.get<ConfirmPaymentAction>(ConfirmPaymentAction);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve ser definido', () => {
    expect(action).toBeDefined();
  });

  describe('execute', () => {
    it('deve confirmar pagamento e vender o assento (Happy Path)', async () => {
      const reservationId = 'res-1';

      mockPrismaService.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        userId: 'user-1',
        seatId: 'seat-1',
        status: ReservationStatus.PENDING,
        expiresAt: new Date(Date.now() + 30_000),
        seat: {
          id: 'seat-1',
          session: {
            price: 25,
          },
        },
      });

      mockTx.reservation.updateMany.mockResolvedValue({ count: 1 });
      mockTx.seat.updateMany.mockResolvedValue({ count: 1 });
      mockTx.sale.create.mockResolvedValue({ id: 'sale-1' });
      mockTx.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        userId: 'user-1',
        seatId: 'seat-1',
        status: ReservationStatus.CONFIRMED,
        expiresAt: new Date(Date.now() + 30_000),
      });

      const result = await action.execute(reservationId);

      expect(result).toHaveProperty(
        'message',
        'Pagamento confirmado! Bom filme.',
      );
      expect(mockAmqpConnection.publish).toHaveBeenCalledWith(
        'cinema_events',
        'payment.confirmed',
        expect.objectContaining({
          reservationId,
          userId: 'user-1',
          seatId: 'seat-1',
        }),
        { persistent: true },
      );
      expect(mockRedisClient.del).toHaveBeenCalledWith('lock:seat:seat-1');
    });

    it('não deve publicar evento novamente se a reserva já estiver CONFIRMED (idempotência)', async () => {
      const reservationId = 'res-confirmed';

      mockPrismaService.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        userId: 'user-1',
        seatId: 'seat-1',
        status: ReservationStatus.CONFIRMED,
        expiresAt: new Date(Date.now() + 30_000),
        seat: {
          id: 'seat-1',
          session: {
            price: 25,
          },
        },
      });

      await expect(action.execute(reservationId)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(mockAmqpConnection.publish).not.toHaveBeenCalled();
    });

    it('deve cancelar e lançar BadRequestException se a reserva expirou', async () => {
      const reservationId = 'res-expired';

      mockPrismaService.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        userId: 'user-1',
        seatId: 'seat-1',
        status: ReservationStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000),
        seat: {
          id: 'seat-1',
          session: {
            price: 25,
          },
        },
      });

      mockPrismaService.reservation.update.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CANCELLED,
      });

      await expect(action.execute(reservationId)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockPrismaService.reservation.update).toHaveBeenCalledWith({
        where: { id: reservationId },
        data: { status: ReservationStatus.CANCELLED },
      });
      expect(mockAmqpConnection.publish).not.toHaveBeenCalled();
    });

    it('deve lançar NotFoundException se a reserva não existir', async () => {
      mockPrismaService.reservation.findUnique.mockResolvedValue(null);

      await expect(action.execute('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar BadRequestException se a reserva já estiver CANCELLED', async () => {
      const reservationId = 'res-cancelled';

      mockPrismaService.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CANCELLED,
      });

      await expect(action.execute(reservationId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
