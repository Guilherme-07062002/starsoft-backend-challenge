import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';

@Global()
@Module({
  imports: [
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: 'cinema_events', // Nome da Exchange
          type: 'topic',         // Tipo Topic permite roteamento flexível
        },
      ],
      uri: process.env.RABBITMQ_URI || 'amqp://user:pass@rabbitmq:5672',
      connectionInitOptions: { wait: false },
    }),
  ],
  exports: [RabbitMQModule], // Exporta para usarmos nos Services
})
export class MessagingModule {} // Chamei de MessagingModule pra ficar genérico