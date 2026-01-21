import type { LoggerService } from '@nestjs/common';

type Level = 'debug' | 'verbose' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  verbose: 15,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeMinLevel(value?: string): Level {
  const v = (value || 'info').toLowerCase();
  if (v === 'debug') return 'debug';
  if (v === 'verbose') return 'verbose';
  if (v === 'warn' || v === 'warning') return 'warn';
  if (v === 'error') return 'error';
  return 'info';
}

export class JsonLogger implements LoggerService {
  private readonly minLevel: Level;

  constructor() {
    this.minLevel = normalizeMinLevel(process.env.LOG_LEVEL);
  }

  private shouldLog(level: Level) {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  private write(level: Level, message: unknown, context?: string, trace?: string) {
    if (!this.shouldLog(level)) return;

    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
    };

    if (context) payload.context = context;

    if (message instanceof Error) {
      payload.message = message.message;
      payload.error = {
        name: message.name,
        stack: message.stack,
      };
    } else if (typeof message === 'string') {
      payload.message = message;
    } else {
      payload.message = 'log';
      payload.data = message;
    }

    if (trace) payload.trace = trace;

    const line = JSON.stringify(payload);

    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(line);
      return;
    }

    if (level === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(line);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(line);
  }

  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string) {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }
}
