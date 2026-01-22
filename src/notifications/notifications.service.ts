import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { PinoLogger } from 'nestjs-pino';
import { createExponentialRetryErrorHandler } from '../rabbitmq/rabbitmq.retry';

@Injectable()
export class NotificationsService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(NotificationsService.name);
  }

  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'reservation.created',
    queue: 'reservation_created_queue',
    queueOptions: { durable: true },
    errorHandler: createExponentialRetryErrorHandler(),
  })
  public async handleReservationCreated(msg: {
    id: string;
    userId: string;
    seatId: string;
    reservationId: string;
  }) {
    this.logger.info(
      `🔒 [RESERVATION] Criada reserva ${msg?.id ?? msg?.reservationId ?? '(sem id)'} ` +
        `para o usuário=${msg?.userId ?? '(sem usuário)'} assento=${msg?.seatId ?? '(sem assento)'}`,
    );
  }

  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'payment.confirmed',
    queue: 'email_notification_queue',
    queueOptions: { durable: true },
    errorHandler: createExponentialRetryErrorHandler(),
  })
  public async handlePaymentConfirmed(msg: {
    userId: string;
    seatId: string;
    reservationId: string;
  }) {
    this.logger.info(
      `📧 [EMAIL SERVICE] Recebido evento de venda para: ${msg.userId}`,
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.logger.info(
      `✅ [EMAIL SERVICE] Email de confirmação enviado para usuário ${msg.userId} que comprou o assento ${msg.seatId}!`,
    );
  }

  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'reservation.expired',
    queue: 'analytics_queue',
    queueOptions: { durable: true },
    errorHandler: createExponentialRetryErrorHandler(),
  })
  public async handleReservationExpired(msg: {
    reservationId: string;
    reason: string;
    userId: string;
  }) {
    this.logger.warn(
      `📉 [ANALYTICS] O usuário ${msg.userId} perdeu a reserva ${msg.reservationId}. Motivo: ${msg.reason}`,
    );
  }

  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'seat.released',
    queue: 'seat_released_queue',
    queueOptions: { durable: true },
    errorHandler: createExponentialRetryErrorHandler(),
  })
  public async handleSeatReleased(msg: {
    seatId: string;
    reservationId: string;
  }) {
    this.logger.info(
      `🔓 [SEAT] Assento liberado ${msg.seatId} (reserva: ${msg.reservationId})`,
    );
  }
}
