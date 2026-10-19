import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
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
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
