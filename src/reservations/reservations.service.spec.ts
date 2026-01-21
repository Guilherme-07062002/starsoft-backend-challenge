import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ReservationStatus, SeatStatus } from '@prisma/client';

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

describe('ReservationsService', () => {
  let service: ReservationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
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

    service = module.get<ReservationsService>(ReservationsService);
  });

  afterEach(() => {
    jest.clearAllMocks(); // Limpa a sujeira entre testes
  });

  it('deve ser definido', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('deve criar reservas com sucesso (Happy Path)', async () => {
      // 1. Cenário
      const dto = {
        seatIds: ['seat-1', 'seat-2'],
        userId: 'user-1',
      };

      // Simula que os assentos existem e estão livres
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

      // Simula que o Redis CONSEGUIU o lock ('OK')
      mockRedisClient.set.mockResolvedValue('OK');

      // Simula a criação no banco da primeira reserva
      mockPrismaService.reservation.create.mockResolvedValueOnce({
        id: 'res-1',
        seatId: 'seat-1',
        userId: 'user-1',
        status: ReservationStatus.PENDING,
      });

      // Simula a criação no banco da segunda reserva
      mockPrismaService.reservation.create.mockResolvedValueOnce({
        id: 'res-2',
        seatId: 'seat-2',
        userId: 'user-1',
        status: ReservationStatus.PENDING,
      });

      // 2. Ação
      const result = await service.create(dto);

      // 3. Verificação (Asserts)
      expect(result).toHaveProperty('reservationIds', ['res-1', 'res-2']);

      // Verifica se tentou pegar lock no Redis para cada assento
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'lock:seat:seat-1', // Chave correta
        'user-1',
        'PX',
        30000,
        'NX', // Flag de atomicidade
      );
    });

    it('deve lançar ConflictException se o Redis já tiver lock (Race Condition)', async () => {
      // 1. Cenário
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

      // Simula o Redis CONSEGUIU o lock do primeiro assento
      mockRedisClient.set.mockResolvedValueOnce('OK');

      // Simula que o Redis FALHOU o lock do segundo assento
      mockRedisClient.set.mockResolvedValueOnce(null);

      // 2. Ação e Verificação
      await expect(service.create(dto)).rejects.toThrow(ConflictException);

      // Garante que NÃO tentou salvar no banco
      expect(mockPrismaService.reservation.create).not.toHaveBeenCalled();
    });

    it('deve lançar erro se o assento já estiver vendido (SOLD)', async () => {
      const dto = { seatIds: ['seat-sold', 'seat-2'], userId: 'user-1' };

      mockPrismaService.seat.findMany.mockResolvedValue([
        {
          id: 'seat-sold',
          status: SeatStatus.SOLD, // Assento já vendido
        },
        {
          id: 'seat-2',
          status: SeatStatus.AVAILABLE,
        },
      ]);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockRedisClient.set).not.toHaveBeenCalled(); // Nem tenta ir no Redis
    });

    it('deve lançar NotFoundException se o assento não existir', async () => {
      const dto = {
        seatIds: ['seat-exists', 'seat-non-existent'],
        userId: 'user-1',
      };

      // Simula que o banco só retornou 1 dos 2 assentos pedidos
      mockPrismaService.seat.findMany.mockResolvedValue([
        {
          id: 'seat-exists',
          status: SeatStatus.AVAILABLE,
        },
      ]);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('deve fazer rollback (deletar locks) se falhar no meio da aquisição', async () => {
      const dto = { seatIds: ['seat-1', 'seat-2', 'seat-3'], userId: 'user-1' };

      mockPrismaService.seat.findMany.mockResolvedValue([
        { id: 'seat-1', status: SeatStatus.AVAILABLE },
        { id: 'seat-2', status: SeatStatus.AVAILABLE },
        { id: 'seat-3', status: SeatStatus.AVAILABLE },
      ]);

      // Simula sucesso nos 2 primeiros e falha no 3º
      mockRedisClient.set.mockResolvedValueOnce('OK');
      mockRedisClient.set.mockResolvedValueOnce('OK');
      mockRedisClient.set.mockResolvedValueOnce(null); // Falhou

      await expect(service.create(dto)).rejects.toThrow(ConflictException);

      // VERIFICA O ROLLBACK
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        'lock:seat:seat-1',
        'lock:seat:seat-2',
      );
    });
  });

  describe('confirmPayment', () => {
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
      mockTx.sale.upsert.mockResolvedValue({ id: 'sale-1' });
      mockTx.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        userId: 'user-1',
        seatId: 'seat-1',
        status: ReservationStatus.CONFIRMED,
        expiresAt: new Date(Date.now() + 30_000),
      });

      const result = await service.confirmPayment(reservationId);

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

      const result = await service.confirmPayment(reservationId);

      expect(result).toEqual({
        message: 'Pagamento já foi processado anteriormente.',
      });
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

      await expect(service.confirmPayment(reservationId)).rejects.toThrow(
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

      await expect(service.confirmPayment('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar BadRequestException se a reserva já estiver CANCELLED', async () => {
      const reservationId = 'res-cancelled';

      mockPrismaService.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CANCELLED,
      });

      await expect(service.confirmPayment(reservationId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
