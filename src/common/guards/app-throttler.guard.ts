import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const type = context.getType();
    const path = context.switchToHttp().getRequest().url;

    if (path === '/metrics') {
      return true;
    }

    if (type !== 'http') return true;

    return await super.canActivate(context);
  }
}
