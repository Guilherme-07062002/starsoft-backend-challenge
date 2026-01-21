import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsService } from '../src/reservations/reservations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'child_process';
import Redis from 'ioredis';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ConflictException } from '@nestjs/common';

// Aumenta o timeout do Jest pois subir containers leva alguns segundos
jest.setTimeout(60000);

const log = (...args: unknown[]) =>
  // Prefixo simples para diferenciar dos demais logs
  // eslint-disable-next-line no-console
  console.log('[integration:reservations]', ...args);

describe('ReservationsService (Integration)', () => {
  let service: ReservationsService;
  let prismaService: PrismaService;
  let redisClient: Redis;

  // Containers
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;

  beforeAll(async () => {
    log('Iniciando beforeAll: subindo containers de Postgres e Redis...');
    // 1. SOBE O POSTGRES
    const pgImage = 'postgres:15-alpine';
    pgContainer = await new PostgreSqlContainer(pgImage).start();
    const databaseUrl = pgContainer.getConnectionUri();
    log('Postgres iniciado com sucesso em', databaseUrl);

    // 2. SOBE O REDIS
    const redisImage = 'redis:alpine';
    redisContainer = await new RedisContainer(redisImage).start();
    const redisUrl = redisContainer.getConnectionUrl();
    log('Redis iniciado com sucesso em', redisUrl);

    // 3. APLICA AS MIGRATIONS DO PRISMA NO CONTAINER
    // Truque: Sobrescrevemos a env var DATABASE_URL apenas para este comando rodar
    process.env.DATABASE_URL = databaseUrl;
    log('Aplicando migrations Prisma no banco de teste...');
    execSync('npx prisma db push --skip-generate', { env: process.env });
    log('Migrations aplicadas com sucesso.');

    // 4. CONFIGURA O MÓDULO DE TESTE
    log('Compilando módulo Nest de teste...');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        PrismaService,
        {
          provide: 'REDIS_CLIENT',
          useFactory: () => {
            // Conecta no Redis do Container
            return new Redis(redisUrl);
          },
        },
        {
          provide: AmqpConnection,
          useValue: { publish: jest.fn() }, // Mockamos RabbitMQ (foco é DB/Redis aqui)
        },
      ],
    }).compile();

    service = module.get<ReservationsService>(ReservationsService);
    prismaService = module.get<PrismaService>(PrismaService);
    redisClient = module.get('REDIS_CLIENT');

    log('beforeAll concluído: ambiente de integração pronto.');
  });

  afterAll(async () => {
    log('Finalizando testes de integração, encerrando recursos...');
    // Desliga tudo ao final
    await redisClient.quit();
    await prismaService.$disconnect();
    await redisContainer.stop();
    await pgContainer.stop();
  });

  beforeEach(async () => {
    // Limpa os dados entre os testes (Truncate tables)
    // Cuidado com a ordem por causa das Foreign Keys
    log('Limpando dados do Postgres e Redis antes do teste...');
    await prismaService.sale.deleteMany();
    await prismaService.reservation.deleteMany();
    await prismaService.seat.deleteMany();
    await prismaService.session.deleteMany();
    await redisClient.flushall();
  });

  it('deve criar uma reserva real no Postgres e travar no Redis', async () => {
    log('Cenário 1: reserva real + lock no Redis.');
    // A. PREPARA O CENÁRIO (Seed)
    const session = await prismaService.session.create({
      data: {
        movieId: 'movie-1',
        room: 'IMAX',
        price: 50.0,
        startsAt: new Date(),
        seats: {
          create: [
            { row: 'A', number: 1, status: 'AVAILABLE' },
            { row: 'A', number: 2, status: 'AVAILABLE' },
          ],
        },
      },
      include: { seats: true },
    });

    const seatId1 = session.seats[0].id;
    const seatId2 = session.seats[1].id;

    // B. EXECUTA A AÇÃO
    const dto = {
      userId: 'user-integration-test',
      seatIds: [seatId1, seatId2],
    };

    const result = await service.create(dto);

    // C. VALIDAÇÕES REAIS

    // 1. Verificou o retorno?
    expect(result.reservationIds).toHaveLength(2);

    // 2. Gravou no Postgres?
    const reservationsDb = await prismaService.reservation.findMany();
    expect(reservationsDb).toHaveLength(2);
    expect(reservationsDb[0].status).toBe('PENDING');

    // 3. Gravou no Redis? (O teste de fogo!)
    const lock1 = await redisClient.get(`lock:seat:${seatId1}`);
    const lock2 = await redisClient.get(`lock:seat:${seatId2}`);

    expect(lock1).toBe('user-integration-test');
    expect(lock2).toBe('user-integration-test');

    log('Cenário 1 validado com sucesso.');
  });

  it('deve impedir Double Booking real usando Redis', async () => {
    log('Cenário 2: impedir double booking com Redis.');
    // A. Setup
    const session = await prismaService.session.create({
      data: {
        movieId: 'movie-1',
        room: 'Sala 2',
        price: 20.0,
        startsAt: new Date(),
        seats: { create: [{ row: 'B', number: 1 }] },
      },
      include: { seats: true },
    });
    const seatId = session.seats[0].id;

    // B. Primeira reserva (Sucesso)
    await service.create({ userId: 'user-A', seatIds: [seatId] });

    // C. Segunda reserva (Deve falhar)
    // Aqui testamos se o Redis REALmente bloqueou
    await expect(
      service.create({ userId: 'user-B', seatIds: [seatId] }),
    ).rejects.toThrow(ConflictException);

    log('Cenário 2 validado com sucesso.');
  });
});
