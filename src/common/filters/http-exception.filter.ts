import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { databaseConflict } from '../database-conflict';
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    error = databaseConflict(error) ?? error;
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      error instanceof HttpException
        ? error.getResponse()
        : { message: 'Internal server error' };
    const normalized = typeof body === 'string' ? { message: body } : body;
    response.status(status).json({
      statusCode: status,
      ...normalized,
      path: request.url
        .split('?')[0]
        .replace(
          /(\/booking-(?:verifications|confirmations)\/)[^/]+/g,
          '$1[redacted]',
        )
        .replace(/(\/booking-requests\/)[^/]+(?=\/resend)/g, '$1[redacted]'),
      timestamp: new Date().toISOString(),
    });
  }
}
