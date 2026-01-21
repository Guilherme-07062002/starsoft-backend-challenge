import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class DlqConsumer {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DlqConsumer.name);
  }

  @RabbitSubscribe({
    exchange: 'cinema_dlq',
    routingKey: '#',
    queue: 'cinema_dlq_queue',
    queueOptions: { durable: true },
  })
  public async handleDlqMessage(msg: any) {
    // Observabilidade: aqui você poderia persistir, alertar, etc.
    this.logger.error(
      { msg },
      '[DLQ] Mensagem enviada para a Dead Letter Queue',
    );
  }
}
