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
      const message =
        typeof body === "string"
          ? body
          : ((body as { message?: unknown }).message ?? exception.message);
      res.status(status).json({
        error: { code: httpCode(status), message, correlationId },
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
