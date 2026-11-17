# ADR 0005: Student drafts, sync and submissions

- Status: Accepted
- Date: 2026-11-17

## Context

Phase 3 of the roadmap requires that a draft survives an app restart, that a stale sync response
can never overwrite newer code, and that students can clearly tell a local save, a server-saved
draft and an accepted submission apart. Lab networks drop, lab PCs crash, and students change the
Windows clock.

## Decision

**Three separate things, shown separately.**

| What         | Where                                                    | Mutable?                                                                                                         |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Local draft  | Encrypted file per seat × question × language            | Yes, every few hundred ms of typing                                                                              |
| Server draft | `student_drafts`, one row per seat × question × language | Yes, only to a higher revision                                                                                   |
| Submission   | `submissions`                                            | No. Code, language and hash are fixed by a DB trigger; only the grading status may change; rows can't be deleted |

**Revisions.** Each local save of new code gets the next revision number. The server stores a
draft only if the incoming revision is higher than the stored one (one `INSERT … ON CONFLICT …
WHERE revision <` statement), otherwise it answers `409 STALE_DRAFT` with its current revision.
The client sends at most one save per draft at a time, bounded overall, and a reply only ever
moves the "server has revision N" mark forward; it never touches the code in the editor. If the
server holds a higher revision from another session, the client re-saves its current code above
that revision and sends again: the copy in front of the student wins.

**Restore.** At sign-in the client merges drafts on this computer with the server's copies; the
higher revision wins. Work typed offline before a crash is restored from disk and sent once the
server is reachable. On sign-in the editor reopens the question the student last edited.

**Languages.** Each language has its own draft. Switching language shows that language's draft
(or a starter template) and keeps the others. A submission uses the language selected when the
student presses Submit.

**Submissions.** The client generates a submission ID when the confirm dialog opens; a retry after
a network error reuses it, so it can't be counted twice. The per-question limit is enforced with a
unique `(seat, question, sequence)` constraint, so concurrent submits can't both take the last
slot. Students see the read-only snapshot and its SHA-256 fingerprint right after submitting.

**Time.** The countdown uses the server's time from each response plus the browser's monotonic
clock, so changing the PC clock has no effect. The server enforces the deadline on every save, run
and submit regardless (`TIME_UP`, `EXAM_PAUSED`, `NOT_IN_EXAM`).

**Sequential exams.** The server tracks the student's position (`navigation_index`). Only the
current question can be read, saved, run or submitted; moving on is one conditional update, so a
retried request can't skip a question.

**Network.** The renderer has no network access (CSP `connect-src 'self'`). All API calls go
through the main process, which holds the session token, only allows `/v1/student/…` paths and
reports failures as `OFFLINE` instead of throwing.

## Consequences

- Run limits (one in flight per student, 10 per minute) are kept in API memory. That is correct
  for a single API instance; Phase 4 moves runs onto the judge queue with a shared limiter.
- Submissions stay `QUEUED` until grading exists (Phase 4).
- If draft encryption isn't available on a PC, drafts are stored unencrypted and the pre-exam
  system check warns the student to tell the invigilator.
