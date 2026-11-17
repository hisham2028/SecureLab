# ADR 0007: Live monitoring, marks and results

- Status: Accepted
- Date: 2026-11-17

## Context

Phase 5 of the roadmap gives hosts a live view of the exam room, a set of audited actions, manual
marking, and a results workflow. The exit gate asks that a host can tell a network drop from a
security event, that focus loss and disconnects are never treated as misconduct, that every manual
change keeps a reason and the previous value, that students see nothing until results are
published, and that the CSV reconciles exactly with the database.

## Decision

**Presence comes from a heartbeat, not a socket.** The student app sends a heartbeat every 15
seconds with the question and language on screen and how often the window lost focus since the
last one. A seat is online if the server heard from it in the last 45 seconds (three missed
beats). Polling works through the lab's proxies and needs no sticky sessions; the host dashboard
polls the monitor every 10 seconds while the exam is live. Seat status (`NOT_STARTED`, `ACTIVE`,
`DISCONNECTED`, `FINISHED`, `BLOCKED`) is derived in one shared function so the API and the
dashboard can't disagree.

**Disconnects and focus are context, not accusations.** The monitor keeps three kinds of signal
apart:

- _Connection_: online, or offline since a time. A gap is logged as `RECONNECTED` with how long it
  lasted, worked out by the server from the gap between heartbeats.
- _Window focus_: `FOCUS_LOST` and `FOCUS_RETURNED` events and a count. The dashboard labels this
  "Left window" and says it is not misconduct by itself.
- _Security events_: a second sign-in for the same seat while the first is still online
  (`PARALLEL_SIGNIN`, from the session id carried in the student token) and a PIN lockout. Only
  these are shown as warnings.

Nothing in the system blocks, submits or marks down a student automatically because of these
signals. Only a person can block a seat, and only with a reason.

**Every host action is a reasoned, audited write.** Announcements, extensions, block and unblock,
re-entry, force-finish, incident notes, regrades, mark changes and hiding results each write an
audit row with the actor, the target, the reason and the previous and new state. Destructive ones
need a confirmation in the dashboard. Requests a role isn't allowed to make, and tokens of the
wrong kind (a student token on a staff route and the reverse) are refused and logged as
`access.denied`.

Force-finish submits the latest draft per question that differs from the last submission, marked
as submitted by staff, so the student's work isn't lost. A regrade gives a failed judge job a fresh
set of retries (`attemptLimit = attempts + 5`); earlier attempts stay in the append-only history.

**Marks are computed, adjustments are appended.** The automatic mark for a question is the best
graded submission. A host can override it or mark it against a rubric (automatic mark plus or
minus rubric points, clamped to the question's points). Each change is a new `mark_adjustments`
row with the automatic mark, the previous mark, the new mark and a mandatory reason; a database
trigger refuses updates and deletes. The latest adjustment wins. All arithmetic is done in integer
hundredths so totals never drift.

**Published results are snapshots.** Finalizing writes an immutable release (version N) with one
entry per student. It is only allowed once the exam has ended, nothing is still being graded and
every failed judge job has a mark set by hand. Publishing points the exam at one release; hiding
clears it. Students read only the published snapshot, so later mark changes don't leak until a
new version is saved and published, and the dashboard says when marks have changed since the last
version. The CSV is generated from the same snapshot, with formula-injection escaping, so its
totals are the database's totals.

## Consequences

- The monitor is one query per page plus aggregate counts. At 60 seats and a 10 second poll this is
  negligible; it would need a cache or push channel for thousands of concurrent seats.
- A student on a flaky network shows as disconnected for up to 45 seconds after the network drops
  and reconnects with no action needed.
- Result releases are append-only, so storage grows with each saved version. Versions are small
  (one row per student).
