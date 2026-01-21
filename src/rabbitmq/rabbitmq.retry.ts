import type { MessageErrorHandler } from '@golevelup/nestjs-rabbitmq';

/**
 * Opções para configuração do retry exponencial.
 */
export interface ExponentialRetryOptions {
  retryExchange: string;
  dlqExchange: string;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Opção padrão para o retry exponencial.
 */
const defaultOptions: ExponentialRetryOptions = {
  retryExchange: 'cinema_retry',
  dlqExchange: 'cinema_dlq',
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Converte um valor desconhecido para número seguro, retornando um valor padrão se a conversão falhar.
 * @param value Valor a ser convertido para número.
 * @param fallback Valor padrão a ser retornado se a conversão falhar.
 * @returns Número convertido ou o valor padrão.
 */
const toSafeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Cria um manipulador de erros que implementa uma estratégia de retry exponencial.
 * @param overrides Opções para sobrescrever as configurações padrão de retry.
 * @returns Manipulador de erros para uso com RabbitSubscribe.
 */
export const createExponentialRetryErrorHandler = (
  overrides: Partial<ExponentialRetryOptions> = {},
): MessageErrorHandler => {
  const options: ExponentialRetryOptions = { ...defaultOptions, ...overrides };

  return async (channel, msg, error) => {
    const headers = (msg.properties.headers ?? {}) as Record<string, unknown>;

    const retryCount = toSafeNumber(headers['x-retry-count'], 0);
    const routingKey = msg.fields.routingKey;
    const sourceExchange = msg.fields.exchange;

    const nextHeaders: Record<string, unknown> = {
      ...headers,
      'x-retry-count': retryCount + 1,
      'x-original-exchange': headers['x-original-exchange'] ?? sourceExchange,
      'x-original-routing-key': headers['x-original-routing-key'] ?? routingKey,
      'x-last-error': String(error?.message ?? error ?? 'unknown'),
    };

    // Configurações comuns para publicação da mensagem
    const publishOptions = {
      persistent: true,
      contentType: msg.properties.contentType,
      contentEncoding: msg.properties.contentEncoding,
      correlationId: msg.properties.correlationId,
      messageId: msg.properties.messageId,
      timestamp: msg.properties.timestamp,
      type: msg.properties.type,
      appId: msg.properties.appId,
      headers: nextHeaders,
    };

    // Verifica se atingiu o número máximo de retries
    // Se sim, envia para a DLQ (dead-letter queue)
    if (retryCount >= options.maxRetries) {
      channel.publish(
        options.dlqExchange,
        routingKey,
        msg.content,
        publishOptions,
      );
      channel.ack(msg);
      return;
    }

    // Calcula o delay usando backoff exponencial
    const delayMs = Math.min(
      options.maxDelayMs,
      options.baseDelayMs * 2 ** retryCount,
    );

    // Publica a mensagem na exchange de retry com o delay calculado
    channel.publish(options.retryExchange, routingKey, msg.content, {
      ...publishOptions,
      expiration: String(delayMs),
    });

    // Confirma o processamento da mensagem original
    channel.ack(msg);
  };
};

export const exponentialRetryErrorHandler =
  createExponentialRetryErrorHandler();
