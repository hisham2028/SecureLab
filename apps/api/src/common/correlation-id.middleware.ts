import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const CORRELATION_HEADER = "x-correlation-id";
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Accepts a well-formed inbound correlation ID or mints one, and echoes it back. */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header(CORRELATION_HEADER);
    const id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
    (req as Request & { correlationId: string }).correlationId = id;
    res.setHeader(CORRELATION_HEADER, id);
    next();
  }
}
