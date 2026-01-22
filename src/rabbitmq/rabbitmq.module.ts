import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { DlqConsumer } from './rabbitmq.dlq.consumer';

@Global()
@Module({
  imports: [
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: 'cinema_events',
          type: 'topic',
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
          name: 'cinema_retry_queue',
          exchange: 'cinema_retry',
          routingKey: '#',
          options: {
            durable: true,
            deadLetterExchange: 'cinema_events',
          },
        },
        {
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
  exports: [RabbitMQModule],
})
export class MessagingModule {}
