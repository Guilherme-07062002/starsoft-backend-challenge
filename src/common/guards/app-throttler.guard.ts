import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Verifica o tipo do contexto
    const type = context.getType();

    // 2. Se NÃO for HTTP (ex: rpc, ws, ou rabbitmq), libera geral.
    // O RabbitMQ não deve ser taxado pelo Rate Limit da API.
    if (type !== 'http') {
      return true;
    }

    // 3. Se for HTTP, roda a lógica padrão do Throttler
    return super.canActivate(context);
  }
}
