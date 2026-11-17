# ADR 0004: Student exam credentials (access code + per-seat PIN)

- Status: Accepted (can be revisited if an institution identity provider becomes available)
- Date: 2026-11-17

## Context

The roadmap rules out signing in with a name and student ID alone. Lab PCs are shared, students
may not have institution SSO accounts usable on lab machines, and the host needs a way to recover
a locked-out student quickly at the desk.

## Decision

- Each exam has a random 8-character **access code** (no look-alike characters).
- Each registration (a student's seat in one exam) gets a random **6-digit PIN**, shown to the
  host once at registration and stored only as an argon2id hash.
- Students sign in with access code + custom student ID + PIN. Unknown exam, unknown ID and wrong
  PIN return the same message and take similar time.
- **5 wrong PINs lock the seat.** An invigilator or host resets the PIN, which unlocks it and
  immediately ends any existing session for that seat.
- Student tokens identify the seat (registration), not the person, and only reach routes marked
  `@StudentRoute()`. All other routes are staff-only by default.

## Consequences

- Hosts must distribute PINs (print slips or a sheet per lab). A printable PIN sheet belongs in the
  host dashboard work.
- A 6-digit PIN is weak on its own; the lockout is what makes guessing impractical. If students
  sign in from outside the lab network, add IP-based rate limiting too.
