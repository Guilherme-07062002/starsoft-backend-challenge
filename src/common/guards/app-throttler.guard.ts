import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Guarda de Throttling personalizada para a aplicação.
 * Esta guarda permite que requisições de contextos não HTTP (como RabbitMQ) sejam isentas do rate limiting.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Verifica o tipo do contexto
    const type = context.getType();

    // 2. Se NÃO for HTTP (ex: rpc, ws, ou rabbitmq) libera
    // O RabbitMQ não deve ser taxado pelo Rate Limit da API.
    if (type !== 'http') return true;

    // 3. Se for HTTP, roda a lógica padrão do Throttler
    return await super.canActivate(context);
  }
}
