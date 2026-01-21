import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { DlqConsumer } from './rabbitmq.dlq.consumer';

@Global()
@Module({
  imports: [
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: 'cinema_events', // Nome da Exchange
          type: 'topic', // Tipo Topic permite roteamento flexível
        },
        {
          name: 'cinema_retry',
          type: 'topic',
        },
        {
          name: 'cinema_dlq',
          type: 'topic',
        },
      ],
      queues: [
        {
          // Fila de retry sem consumidor: mensagens ficam aqui até expirar (TTL por mensagem)
          // e então são dead-lettered de volta para cinema_events (mesma routingKey original).
          name: 'cinema_retry_queue',
          exchange: 'cinema_retry',
          routingKey: '#',
          options: {
            durable: true,
            deadLetterExchange: 'cinema_events',
          },
        },
        {
          // Dead Letter Queue central para mensagens que excederam max retries
          name: 'cinema_dlq_queue',
          exchange: 'cinema_dlq',
          routingKey: '#',
          options: {
            durable: true,
          },
        },
      ],
      uri: process.env.RABBITMQ_URI || 'amqp://user:pass@rabbitmq:5672',
      connectionInitOptions: { wait: false },
    }),
  ],
  providers: [DlqConsumer],
  exports: [RabbitMQModule], // Exporta para usarmos nos Services
})
export class MessagingModule {} // Chamei de MessagingModule pra ficar genérico
