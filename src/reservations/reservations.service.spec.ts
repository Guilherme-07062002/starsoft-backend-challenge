import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ReservationStatus, SeatStatus } from '@prisma/client';

// Mocks (Dublês dos serviços reais)
const mockPrismaService = {
  seat: {
    findMany: jest.fn(),
  },
  reservation: {
    create: jest.fn(),
  },
  // Prisma usa `$transaction` (não `transaction`).
  // Suporta as 2 assinaturas: callback e array de Promises.
  $transaction: jest.fn(async (arg) => {
    if (typeof arg === 'function') {
      return arg(mockPrismaService);
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
        userId: 'user-1' 
      };
      
      // Simula que os assentos existem e estão livres
      mockPrismaService.seat.findMany.mockResolvedValue([{ 
        id: 'seat-1', 
        status: SeatStatus.AVAILABLE
      }, {
        id: 'seat-2',
        status: SeatStatus.AVAILABLE
      }]);

      // Simula que o Redis CONSEGUIU o lock ('OK')
      mockRedisClient.set.mockResolvedValue('OK');

      // Simula a criação no banco da primeira reserva
      mockPrismaService.reservation.create.mockResolvedValueOnce({
        id: 'res-1',
        seatId: 'seat-1',
        userId: 'user-1',
        status: ReservationStatus.PENDING
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
        'NX' // Flag de atomicidade
      );
    });

    it('deve lançar ConflictException se o Redis já tiver lock (Race Condition)', async () => {
      // 1. Cenário
      const dto = { seatIds: ['seat-1', 'seat-2'], userId: 'user-2' };

      mockPrismaService.seat.findMany.mockResolvedValue([{ 
        id: 'seat-1', 
        status: SeatStatus.AVAILABLE 
      }, {
        id: 'seat-2',
        status: SeatStatus.AVAILABLE
      }]);

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

      mockPrismaService.seat.findMany.mockResolvedValue([{ 
        id: 'seat-sold', 
        status: SeatStatus.SOLD // Assento já vendido
      }, {
        id: 'seat-2',
        status: SeatStatus.AVAILABLE
      }]);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockRedisClient.set).not.toHaveBeenCalled(); // Nem tenta ir no Redis
    });
  });
});