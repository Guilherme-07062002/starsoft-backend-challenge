import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * Módulo de notificações que gerencia o envio de notificações aos usuários.
 */
@Module({
  controllers: [],
  providers: [NotificationsService],
})
export class NotificationsModule {}
