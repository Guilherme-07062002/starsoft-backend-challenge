import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // 1. Escuta o evento de PAGAMENTO CONFIRMADO
  @RabbitSubscribe({
    exchange: 'cinema_events',       // A mesma exchange que definimos no module
    routingKey: 'payment.confirmed', // A chave que usamos no publish
    queue: 'email_notification_queue', // Nome da fila (se cair o app, as msg ficam aqui)
  })
  public async handlePaymentConfirmed(msg: any) {
    // Simula um processamento pesado (envio de email)
    this.logger.log(`📧 [EMAIL SERVICE] Recebido evento de venda para: ${msg.userId}`);
    
    // Simulação de delay (como se estivesse conectando no SMTP)
    await new Promise(resolve => setTimeout(resolve, 1000));

    this.logger.log(`✅ [EMAIL SERVICE] Email de confirmação enviado para o assento ${msg.seatId}!`);
    
    // Se der erro aqui, o RabbitMQ tenta entregar de novo automaticamente!
  }

  // 2. (Bônus) Escuta o evento de RESERVA EXPIRADA (que seu Cron Job dispara)
  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'reservation.expired',
    queue: 'analytics_queue', // Fila diferente, consumidor diferente
  })
  public async handleReservationExpired(msg: any) {
    this.logger.warn(`📉 [ANALYTICS] O usuário perdeu a reserva ${msg.reservationId}. Motivo: ${msg.reason}`);
  }

  // 3. Evento explícito de assento liberado
  @RabbitSubscribe({
    exchange: 'cinema_events',
    routingKey: 'seat.released',
    queue: 'seat_released_queue',
  })
  public async handleSeatReleased(msg: any) {
    this.logger.log(
      `🔓 [SEAT] Assento liberado ${msg.seatId} (reserva: ${msg.reservationId})`,
    );
  }
}