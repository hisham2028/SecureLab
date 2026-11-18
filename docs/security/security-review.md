# Security review and remediation log (Phase 6)

- Date: 2026-11-18
- Scope: API, host dashboard, student desktop client, grading worker and judge boundary,
  administrative access
- Reviewer: the SecureLab development team (internal review). **An independent penetration test
  is still required before the pilot**; this document is the input to it, not a substitute.

The judge boundary was reviewed separately in Phase 4; see
[execution-boundary.md](execution-boundary.md).

## Method

1. Listed every route and who may call it ([route matrix](#route-matrix)).
2. Checked each route for authentication, role, tenant scoping (institution) and scoping of
   every sub-resource to its exam, and for input validation.
3. Looked at how sessions start and end for staff and students.
4. Looked at abuse from outside (guessing) and inside the lab (a student with the same PC
   account as others).
5. Looked at transport, headers, configuration and the desktop client's trust in its own
   settings.
6. Wrote an automated test for each fix (`apps/api/test/phase6.e2e-spec.ts`,
   `apps/student/src/main/config.test.ts`).

## Findings and remediation

| #   | Finding                                                                                                                                                                                                                           | Severity | Status                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Staff sign-in had no limit on password guesses.                                                                                                                                                                                   | High     | Fixed. 10 attempts per email and IP per 5 minutes, 60 per IP per minute; then `429 RATE_LIMITED` with `Retry-After`. Test: "slows down password and PIN guessing".                                                                                         |
| S2  | Staff tokens stayed valid until they expired (1 h) after an account was deactivated or its role was lowered, and there was no way to end a session.                                                                               | High     | Fixed. Every staff request checks the account (active, role, token version). Deactivation and role changes end sessions at once; "sign out everywhere" and an admin "end sessions" (with reason, audited) were added. Test: "ends staff sessions at once". |
| S3  | The installed student app accepted the server address from an environment variable or a per-user `config.json`. Anyone using a shared lab account could point other students' app at a server of their choosing and collect PINs. | High     | Fixed. Installed builds read only the `config.json` next to `SecureLab.exe` (per-machine install under Program Files, admin-writable only). Test: "ignores student-writable settings in an installed build".                                               |
| S4  | Student sign-in and the result lookup could be guessed against at speed. Each seat already locks after 5 wrong PINs, but guessing across many seats wasn't slowed.                                                                | Medium   | Fixed. 10 attempts per seat per minute, 600 per IP per minute (labs share one IP, so per-IP limits are deliberately loose).                                                                                                                                |
| S5  | A database outage returned `500 INTERNAL`, which the student app shows as an error rather than "offline, keep working".                                                                                                           | Medium   | Fixed. Connection-level database errors return `503 SERVICE_UNAVAILABLE` with `Retry-After`; the student app treats 502–504 as offline and keeps saving locally. Test: "reports a database outage as a temporary failure".                                 |
| S6  | No security headers; `X-Powered-By: Express` was sent.                                                                                                                                                                            | Low      | Fixed. `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `CSP: default-src 'none'`, `Cache-Control: no-store`, HSTS in production. Test: "sends strict security headers".                                                                |
| S7  | The API would start in production with the example `JWT_SECRET`, an empty CORS list or the in-process grading worker.                                                                                                             | Low      | Fixed. Boot fails with a list of unsafe settings when `NODE_ENV=production`.                                                                                                                                                                               |
| S8  | Rate-limit counters live in API memory. With more than one API instance each has its own counters.                                                                                                                                | Low      | Accepted for the pilot (one API instance). Move to a shared store before scaling out.                                                                                                                                                                      |
| S9  | Anyone who knows a student's ID and the exam code can lock that student's seat by entering 5 wrong PINs (a nuisance attack from inside the lab).                                                                                  | Low      | Accepted. The lock is shown on the Live tab as "PIN locked"; an invigilator resets the PIN in seconds and the reset is audited. Rate limits make it slower to do to many seats.                                                                            |
| S10 | The API speaks plain HTTP. On a lab network a student could read other students' traffic (tokens, code) with the right access to the network.                                                                                     | Medium   | Open, deployment item. Put the API behind a TLS reverse proxy (`TRUST_PROXY=1`) and use an `https://` address in `config.json`. Listed on the [pilot readiness checklist](../ops/pilot-readiness.md).                                                      |
| S11 | The Windows installer isn't code-signed, so Windows SmartScreen warns and nothing proves the installer came from you.                                                                                                             | Medium   | Open, needs a code-signing certificate. The app has no auto-updater, so there is no channel through which an update can be silently replaced; lab IT installs each version. Checklist item: sign installers and publish checksums.                         |
| S12 | Independent penetration test of the API, client trust model, judge isolation and admin access.                                                                                                                                    | Gate     | Open. Must be done by someone outside the team before the pilot.                                                                                                                                                                                           |

No critical findings were found. The two open Medium items (S10, S11) are deployment tasks with
clear fixes; S12 is a release gate the team can't close on its own.

## What was checked and found sound

- **Authentication.** Every route needs a bearer token unless marked public. Public routes are
  health checks, staff sign-in, student sign-in and the student result lookup. Tokens are HS256
  with an algorithm allow-list. Staff passwords use argon2id, and unknown emails cost the same
  time as wrong passwords. Student tokens carry a credential version that changes when the PIN
  is reset, which ends old sessions.
- **Token kinds.** A student token on a staff route, or the reverse, is refused and logged as
  `access.denied`.
- **Roles.** Each controller declares its roles, and refusals are logged. The role is now read
  from the database on every request, not trusted from the token.
- **Tenancy.** Every staff query for an exam goes through `ExamsService.load`, which filters by
  the caller's institution. Every sub-resource (registration, submission, release, exam question)
  is looked up together with its exam ID, so an ID from another exam or institution gives 404.
  Questions and staff accounts are filtered by institution.
- **Students.** Every student route is scoped to the seat in the token. Hidden tests never reach
  student responses or logs (Phase 4 test).
- **Input validation.** Every request body and query goes through a zod schema. Every path ID
  goes through UUID parsing. Bodies are capped at 1 MB and code at 256K characters.
- **Audit.** Staff actions, sign-ins, failed sign-ins, refusals, regrades, mark changes and
  result publishing are append-only rows. Immutability triggers protect submissions,
  evaluations, mark adjustments, result releases and incident notes.
- **CORS.** CORS allows only the origins in `CORS_ORIGINS`, with no wildcard. Staff tokens are
  held in memory in the host app, never in localStorage or cookies, so CSRF doesn't apply.
- **Desktop client.**
  - The renderer is sandboxed, with context isolation and no Node access.
  - Network requests go through the main process to the configured API only (`isAllowedRequest`).
  - Local drafts are encrypted.
  - The app has no auto-updater and loads no remote code.

## Route matrix

The route list with roles is in the [README](../../README.md#api-overview). Summary:

| Caller        | Can reach                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Anyone        | `/health/*`, `POST /v1/auth/login`, `POST /v1/student/session`, `POST /v1/student/result` (all rate-limited but health)                       |
| Student token | `/v1/student/exam/**` for its own seat only                                                                                                   |
| Invigilator   | Read exams; live monitor; announcements, notes, block/unblock, re-entry, extensions, PIN resets                                               |
| Host          | Everything an invigilator can, plus questions, exams, registrations, marks, results, submission review, force-finish, regrade, grading status |
| Admin         | Everything a host can, plus staff accounts and ending staff sessions                                                                          |

## Residual risks the pilot accepts

- Full screen is not lockdown. A student can use other apps on the PC unless the lab locks the
  PC down with OS or device management (ADR 0002). Leaving the window is recorded and shown, but
  never acted on automatically.
- A student can run Python or C on their own input through **Run**. This is inside Judge0's
  sandbox (Phase 4 report).
- The team wrote these tests itself (see S12).
