import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { PinoLogger } from 'nestjs-pino';
import { exponentialRetryErrorHandler } from '../rabbitmq/rabbitmq.retry';

/**
 * Serviço responsável por escutar eventos do RabbitMQ relacionados a notificações.
 * Ele consome eventos como criação de reservas, confirmações de pagamento,
 * expiração de reservas e liberação de assentos, realizando ações como
 * logging e simulação de envio de emails.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(NotificationsService.name);
  }

  /**
   * Escuta o evento de CRIAÇÃO DE RESERVA
   * @param msg - Mensagem recebida do RabbitMQ contendo detalhes da reserva criada.
   */
  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'reservation.created',
    queue: 'reservation_created_queue',
    queueOptions: { durable: true },
    errorHandler: exponentialRetryErrorHandler,
  })
  public async handleReservationCreated(msg: any) {
    // Exemplo de consumidor: auditoria/analytics/observabilidade.
    // Se lançar exceção, o RabbitMQ pode reenfileirar a mensagem (dependendo da configuração).
    this.logger.info(
      `[RESERVATION] Criada reserva ${msg?.id ?? msg?.reservationId ?? '(sem id)'} ` +
        `para user=${msg?.userId ?? '(sem user)'} seat=${msg?.seatId ?? '(sem seat)'}`,
    );
  }

  /**
   * Escuta o evento de CONFIRMAÇÃO DE PAGAMENTO
   * @param msg - Mensagem recebida do RabbitMQ contendo detalhes do pagamento confirmado.
   */
  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'payment.confirmed',
    queue: 'email_notification_queue',
    queueOptions: { durable: true },
    errorHandler: exponentialRetryErrorHandler,
  })
  public async handlePaymentConfirmed(msg: any) {
    // Simula um processamento pesado (envio de email)
    this.logger.info(
      `📧 [EMAIL SERVICE] Recebido evento de venda para: ${msg.userId}`,
    );

    // Simulação de delay (como se estivesse conectando no SMTP)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.logger.info(
      `✅ [EMAIL SERVICE] Email de confirmação enviado para o assento ${msg.seatId}!`,
    );

    // Se der erro aqui, cai no retry com backoff (cinema_retry_queue) e depois DLQ.
  }

  /**
   * Escuta o evento de EXPIRAÇÃO DE RESERVA
   * @param msg - Mensagem recebida do RabbitMQ contendo detalhes da reserva expirada.
   */
  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'reservation.expired',
    queue: 'analytics_queue',
    queueOptions: { durable: true },
    errorHandler: exponentialRetryErrorHandler,
  })
  public async handleReservationExpired(msg: any) {
    this.logger.warn(
      `📉 [ANALYTICS] O usuário perdeu a reserva ${msg.reservationId}. Motivo: ${msg.reason}`,
    );
  }

  /**
   * Escuta o evento de LIBERAÇÃO DE ASSENTO
   * @param msg - Mensagem recebida do RabbitMQ contendo detalhes do assento liberado.
   */
  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'seat.released',
    queue: 'seat_released_queue',
    queueOptions: { durable: true },
    errorHandler: exponentialRetryErrorHandler,
  })
  public async handleSeatReleased(msg: any) {
    this.logger.info(
      `🔓 [SEAT] Assento liberado ${msg.seatId} (reserva: ${msg.reservationId})`,
    );
  }
}
