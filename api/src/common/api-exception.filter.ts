import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
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

    const code = typeof exception === 'object' && exception !== null && 'code' in exception
      ? String((exception as { code?: unknown }).code)
      : 'UNKNOWN';
    this.logger.error(`Unhandled request error (${code})`);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
    });
  }
}
