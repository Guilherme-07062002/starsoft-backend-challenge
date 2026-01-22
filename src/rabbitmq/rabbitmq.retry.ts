import type { MessageErrorHandler } from '@golevelup/nestjs-rabbitmq';

export interface ExponentialRetryOptions {
  retryExchange: string;
  dlqExchange: string;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const defaultOptions: ExponentialRetryOptions = {
  retryExchange: 'cinema_retry',
  dlqExchange: 'cinema_dlq',
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

const toSafeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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

    const delayMs = Math.min(
      options.maxDelayMs,
      options.baseDelayMs * 2 ** retryCount,
    );

    channel.publish(options.retryExchange, routingKey, msg.content, {
      ...publishOptions,
      expiration: String(delayMs),
    });

    channel.ack(msg);
  };
};

export const exponentialRetryErrorHandler =
  createExponentialRetryErrorHandler();
