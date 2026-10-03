import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message = typeof payload === 'string'
        ? payload
        : Array.isArray((payload as { message?: unknown }).message)
          ? 'Request validation failed'
          : String((payload as { message?: unknown }).message ?? exception.message);
      response.status(status).json({ error: { code: 'REQUEST_ERROR', message } });
      return;
    }

    const reference = randomUUID().slice(0, 8);
    const pg = exception as {
      code?: unknown;
      detail?: unknown;
      table?: unknown;
      column?: unknown;
      constraint?: unknown;
      hint?: unknown;
    };
    const code = pg.code !== undefined ? String(pg.code) : 'UNKNOWN';
    const message = exception instanceof Error ? exception.message : 'Unknown error';
    const target = [pg.table, pg.column]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('.');
    const details = [
      target ? `target=${target}` : '',
      typeof pg.constraint === 'string' ? `constraint=${pg.constraint}` : '',
      typeof pg.detail === 'string' ? `detail=${pg.detail}` : '',
      typeof pg.hint === 'string' ? `hint=${pg.hint}` : ''
    ].filter(Boolean).join(' | ');

    this.logger.error(
      `Unhandled request error [${reference}] (${code}) ${message}${details ? ` | ${details}` : ''}`,
      exception instanceof Error ? exception.stack : undefined
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: `An unexpected error occurred (ref: ${reference})` }
    });
  }
}
