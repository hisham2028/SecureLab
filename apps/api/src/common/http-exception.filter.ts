import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Common error contract: { error: { code, message, correlationId } }.
 * Unexpected errors are logged with detail but returned to clients without internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Errors");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string }>();
    const correlationId = req.correlationId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const obj = typeof body === "string" ? {} : (body as AppErrorBody);
      const message = typeof body === "string" ? body : (obj.message ?? exception.message);
      // A thrown body may carry its own machine-readable code and safe details for the client.
      const code = typeof obj.code === "string" ? obj.code : httpCode(status);
      res.status(status).json({
        error: {
          code,
          message,
          correlationId,
          ...(obj.details !== undefined ? { details: obj.details } : {}),
        },
      });
      return;
    }

    this.logger.error(
      JSON.stringify({ msg: "unhandled_error", correlationId, path: req.url }),
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(500).json({
      error: { code: "INTERNAL", message: "Something went wrong on our side.", correlationId },
    });
  }
}

interface AppErrorBody {
  message?: unknown;
  code?: unknown;
  details?: unknown;
}

function httpCode(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL" : "ERROR";
  }
}
