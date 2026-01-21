import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class DlqConsumer {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DlqConsumer.name);
  }

  /**
   * Escuta todas as mensagens que chegam na Dead Letter Queue (DLQ)
   * @param msg - Mensagem recebida do RabbitMQ que foi enviada para a DLQ.
   */
  @RabbitSubscribe({
    exchange: 'cinema_dlq',
    routingKey: '#',
    queue: 'cinema_dlq_queue',
    queueOptions: { durable: true },
  })
  public async handleDlqMessage(msg: any) {
    // Observabilidade: Aqui é possível monitorar mensagens que foram para a DLQ
    this.logger.error(
      { msg },
      '[DLQ] Mensagem enviada para a Dead Letter Queue',
    );
  }
}
