import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';

@ApiTags('Health Check (Verificação de Saúde da API)')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private prismaHealth: PrismaHealthIndicator,
    private prisma: PrismaService,
    private amqpConnection: AmqpConnection,
    private healthIndicatorService: HealthIndicatorService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Verifica a saúde da API e seus serviços dependentes',
  })
  async check() {
    return await this.health.check([
      async () => await this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      async () => await this.prismaHealth.pingCheck('database', this.prisma),
      async () => await this.checkRedis(),
      async () => await this.checkRabbitMq(),
    ]);
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('redis');
    try {
      // Envia um comando PING rápido para o Redis
      const pong = await this.redis.ping();

      if (pong !== 'PONG') {
        indicator.down({
          message: 'Redis did not respond with PONG',
          details: { response: pong },
        });
      }

      return indicator.up();
    } catch (error) {
      indicator.down({
        message: 'Redis connection failed',
        error: error.message,
      });
    }
  }

  private async checkRabbitMq(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('rabbitmq');
    try {
      const isConnected = this.amqpConnection.managedConnection.isConnected();
      if (!isConnected) {
        indicator.down({ message: 'RabbitMQ is not connected' });
      }

      return indicator.up();
    } catch (error) {
      indicator.down({
        message: 'RabbitMQ connection failed',
        error: error.message,
      });
    }
  }
}
