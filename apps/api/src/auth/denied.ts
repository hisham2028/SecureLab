import type { AuditService } from "../audit/audit.service";
import type { AuthedRequest, Principal } from "./auth.types";

/** Records a refused request (right sign-in, wrong permission) in the audit log. */
export async function recordDenied(
  audit: AuditService | undefined,
  req: AuthedRequest,
  who: Principal | undefined,
  reason: string,
): Promise<void> {
  if (!audit) return;
  await audit
    .record({
      institutionId: who?.institutionId ?? null,
      actorType: who?.kind ?? "system",
      actorId: who?.sub ?? null,
      action: "access.denied",
      metadata: {
        reason,
        method: req.method,
        // The route pattern, e.g. /v1/exams/:examId/results, plus the concrete path.
        route: (req as { route?: { path?: string } }).route?.path ?? null,
        path: req.originalUrl?.split("?")[0] ?? null,
        role: who && who.kind === "staff" ? who.role : null,
      },
      correlationId: req.correlationId,
    })
    .catch(() => undefined);
}
