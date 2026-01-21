import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { DlqConsumer } from './rabbitmq.dlq.consumer';

/**
 * Módulo de mensageria que configura o RabbitMQ com exchanges, filas e consumidores.
 */
@Global()
@Module({
  imports: [
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: 'cinema_events', // Exchange principal de eventos do sistema
          type: 'topic', // Tipo Topic permite roteamento flexível
        },
        {
          name: 'cinema_retry', // Exchange para mensagens de retry
          type: 'topic',
        },
        {
          name: 'cinema_dlq', // Exchange para Dead Letter Queue
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
  exports: [RabbitMQModule], // Exporta o módulo RabbitMQ para uso em outros módulos
})
export class MessagingModule {}
