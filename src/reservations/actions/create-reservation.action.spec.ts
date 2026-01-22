import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ReservationStatus, SeatStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReservationAction } from './create-reservation.action';

// Mocks (Dublês dos serviços reais)
// Separar o "tx" (transação) do prisma normal ajuda a simular o callback do $transaction.
const mockTx = {
  reservation: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
  },
  seat: {
    updateMany: jest.fn(),
  },
  sale: {
    upsert: jest.fn(),
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

describe('CreateReservationsAction', () => {
  let action: CreateReservationAction;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateReservationAction,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: 'REDIS_CLIENT', // O mesmo nome que usamos no @Inject
          useValue: mockRedisClient,
        },
        {
          provide: AmqpConnection,
          useValue: mockAmqpConnection,
        },
      ],
    }).compile();

    action = module.get<CreateReservationAction>(CreateReservationAction);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve ser definido', () => {
    expect(action).toBeDefined();
  });

  describe('execute', () => {
    it('deve criar reservas com sucesso (Happy Path)', async () => {
      const dto = {
        seatIds: ['seat-1', 'seat-2'],
        userId: 'user-1',
      };

      mockPrismaService.seat.findMany.mockResolvedValue([
        {
          id: 'seat-1',
          status: SeatStatus.AVAILABLE,
        },
        {
          id: 'seat-2',
          status: SeatStatus.AVAILABLE,
        },
      ]);

      mockRedisClient.set.mockResolvedValue('OK');

      mockPrismaService.reservation.create.mockResolvedValueOnce({
        id: 'res-1',
        seatId: 'seat-1',
        userId: 'user-1',
        status: ReservationStatus.PENDING,
      });

      mockPrismaService.reservation.create.mockResolvedValueOnce({
        id: 'res-2',
        seatId: 'seat-2',
        userId: 'user-1',
        status: ReservationStatus.PENDING,
      });

      const result = await action.execute(dto);

      expect(result).toHaveProperty('reservationIds', ['res-1', 'res-2']);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'lock:seat:seat-1',
        'user-1',
        'PX',
        30000,
        'NX',
      );
    });

    it('deve lançar ConflictException se o Redis já tiver lock (Race Condition)', async () => {
      const dto = { seatIds: ['seat-1', 'seat-2'], userId: 'user-2' };

      mockPrismaService.seat.findMany.mockResolvedValue([
        {
          id: 'seat-1',
          status: SeatStatus.AVAILABLE,
        },
        {
          id: 'seat-2',
          status: SeatStatus.AVAILABLE,
        },
      ]);

      mockRedisClient.set.mockResolvedValueOnce('OK');

      mockRedisClient.set.mockResolvedValueOnce(null);

      await expect(action.execute(dto)).rejects.toThrow(ConflictException);

      expect(mockPrismaService.reservation.create).not.toHaveBeenCalled();
    });

    it('deve lançar erro se o assento já estiver vendido (SOLD)', async () => {
      const dto = { seatIds: ['seat-sold', 'seat-2'], userId: 'user-1' };

      mockPrismaService.seat.findMany.mockResolvedValue([
        {
          id: 'seat-sold',
          status: SeatStatus.SOLD,
        },
        {
          id: 'seat-2',
          status: SeatStatus.AVAILABLE,
        },
      ]);

      await expect(action.execute(dto)).rejects.toThrow(ConflictException);
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('deve lançar NotFoundException se o assento não existir', async () => {
      const dto = {
        seatIds: ['seat-exists', 'seat-non-existent'],
        userId: 'user-1',
      };

      mockPrismaService.seat.findMany.mockResolvedValue([
        {
          id: 'seat-exists',
          status: SeatStatus.AVAILABLE,
        },
      ]);

      await expect(action.execute(dto)).rejects.toThrow(NotFoundException);
    });

    it('deve fazer rollback (deletar locks) se falhar no meio da aquisição', async () => {
      const dto = { seatIds: ['seat-1', 'seat-2', 'seat-3'], userId: 'user-1' };

      mockPrismaService.seat.findMany.mockResolvedValue([
        { id: 'seat-1', status: SeatStatus.AVAILABLE },
        { id: 'seat-2', status: SeatStatus.AVAILABLE },
        { id: 'seat-3', status: SeatStatus.AVAILABLE },
      ]);

      mockRedisClient.set.mockResolvedValueOnce('OK');
      mockRedisClient.set.mockResolvedValueOnce('OK');
      mockRedisClient.set.mockResolvedValueOnce(null);

      await expect(action.execute(dto)).rejects.toThrow(ConflictException);

      expect(mockRedisClient.del).toHaveBeenCalledWith(
        'lock:seat:seat-1',
        'lock:seat:seat-2',
      );
    });
  });
});
