import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram } from 'prom-client';

@Injectable()
export class LoggingMetricInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric('http_request_duration_seconds')
    public histogram: Histogram<string>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const method = request.method;
    const route = request.route ? request.route.path : request.url;

    // Inicia o cronômetro
    const end = this.histogram.startTimer();

    return next.handle().pipe(
      tap(() => {
        const response = ctx.getResponse();
        const statusCode = response.statusCode;

        // Para o cronômetro e registra os labels
        end({ method, route, code: statusCode });
      }),
    );
  }
}
