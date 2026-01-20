import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

// Mocks (Dublês dos serviços reais)
const mockPrismaService = {
  seat: {
    findUnique: jest.fn(),
  },
  reservation: {
    create: jest.fn(),
  },
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
    it('deve criar uma reserva com sucesso (Happy Path)', async () => {
      // 1. Cenário
      const dto = { seatId: 'seat-1', userId: 'user-1' };
      
      // Simula que o assento existe e está livre
      mockPrismaService.seat.findUnique.mockResolvedValue({ 
        id: 'seat-1', 
        status: 'AVAILABLE' 
      });

      // Simula que o Redis CONSEGUIU o lock ('OK')
      mockRedisClient.set.mockResolvedValue('OK');

      // Simula a criação no banco
      mockPrismaService.reservation.create.mockResolvedValue({
        id: 'res-1',
        seatId: 'seat-1',
        userId: 'user-1',
        status: 'PENDING',
      });

      // 2. Ação
      const result = await service.create(dto);

      // 3. Verificação (Asserts)
      expect(result).toHaveProperty('reservationId', 'res-1');
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
      const dto = { seatId: 'seat-1', userId: 'user-2' };

      mockPrismaService.seat.findUnique.mockResolvedValue({ 
        id: 'seat-1', 
        status: 'AVAILABLE' 
      });

      // Simula que o Redis FALHOU o lock (retornou null)
      // Isso simula o segundo usuário chegando milissegundos depois
      mockRedisClient.set.mockResolvedValue(null);

      // 2. Ação e Verificação
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      
      // Garante que NÃO tentou salvar no banco
      expect(mockPrismaService.reservation.create).not.toHaveBeenCalled();
    });

    it('deve lançar erro se o assento já estiver vendido (SOLD)', async () => {
      const dto = { seatId: 'seat-sold', userId: 'user-1' };

      mockPrismaService.seat.findUnique.mockResolvedValue({ 
        id: 'seat-sold', 
        status: 'SOLD' // Assento já vendido
      });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockRedisClient.set).not.toHaveBeenCalled(); // Nem tenta ir no Redis
    });
  });
});