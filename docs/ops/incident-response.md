# Incident response runbook

For the exam operator (the person running the server) and the host in the room. Keep a copy on
paper in the lab during an exam. Times in the log are server times.

## Everyone, every incident

1. **Students first.** Tell the room what is happening. Their code is saved on their own PC
   every few seconds and syncs when the server is back. Nobody should restart a PC unless told
   to.
2. **Write it down.** Add an incident note on the exam (Live tab, open a student, or the exam
   notes). Notes can't be edited or deleted. Record times, what you saw, and what you did.
3. **Don't change marks during an incident.** Fix marks afterwards, with reasons, once you know
   what happened.
4. **After the exam,** reconcile:
   - registered students against students who started, finished and submitted
   - the submission count against graded plus failed submissions
   - marks and the published result
     The Results tab and CSV export give these numbers.

## The server or network is down

What students see: an "Offline" status. They keep typing, and Run and Submit say they can't
reach the server. The countdown keeps running from the last server time.

1. Check `GET /health/ready` from the lab, and from the server itself.
   - Lab can't reach it, but the server can: it's the network or firewall.
   - The server can't reach it either: the API or the database is down.
2. Restart what is down. The API, workers and database can be restarted at any time. Nothing
   lives only in memory except rate-limit counters.
3. If the outage ate exam time, give the whole room extra time from the Live tab, or each
   student who lost time. Extensions are audited.
4. If it can't be fixed in a reasonable time, pause the exam (Exam → Pause). Students' timers
   stop. Resume when it's back.
5. Once it's back, the Live tab shows who reconnected and when.

## Grading is behind or stuck

What you see: the Live tab banner says "Grading is running behind" or "A grading worker stopped
responding". The worker log has `judge_queue_alert` lines.

1. Check the workers (`pnpm --filter @securelab/api worker` processes) and Judge0
   (`GET <judge0>/about`). Restart whatever is down. Submissions are stored before they are
   graded and are never lost.
2. A worker that died mid-grading loses its lease. Another worker takes its submissions over
   within about 2 minutes.
3. Submissions the judge gave up on (after 5 tries) are listed at `GET /v1/ops/grading`, and per
   student on the Live tab as "couldn't grade". After fixing the judge, open the student and use
   "Grade it again". Or set the mark by hand with a reason.
4. Students are never marked wrong because of a judge failure.

## Suspected cheating

1. Don't accuse anyone from the dashboard alone. Disconnects and leaving the window are not
   misconduct by themselves.
2. Look at the student. Then, if justified, block the seat (Live tab → student → Block, with a
   reason). The student sees a waiting screen, and their code is kept.
3. Write an incident note with what you observed.
4. Unblock when appropriate. Alternatively, end that student's exam: their latest drafts are
   submitted as staff.
5. Follow the institution's academic-misconduct process. The audit log, notes and submissions
   are the record.

## A staff account may be compromised (lost laptop, shared password)

1. An admin ends that account's sessions:
   `POST /v1/staff/<id>/end-sessions` with `{"reason": "…"}`. Every open session stops working at
   once.
2. Deactivate the account (`PATCH /v1/staff/<id>` with `{"isActive": false}`) until the
   password is changed.
3. Review the audit log for that account's actions since the suspected time:
   `select * from audit_logs where actor_id = '<id>' and created_at > '<time>' order by created_at;`
4. If marks or results were changed, every change is a separate row with the previous value
   and a reason. Restore the right values with new changes that reference the incident.

## Exam codes or PINs leaked

- **One student's PIN.** Reset it from the Students tab. Old sessions for that seat end at
  once. Give the student the new PIN slip.
- **The access code before the exam.** It only works with a student ID and that student's PIN,
  so a leaked access code alone isn't enough to sign in. If PIN slips leaked too, reset the
  affected PINs.

## The judge may be compromised (code escaped the sandbox)

1. Stop the Judge0 host from the network. Grading pauses, and submissions keep queueing safely.
2. The Judge0 host holds no SecureLab secrets and no hidden expected outputs (Phase 4 report).
   Assume test inputs and submitted code on that host were exposed.
3. Rebuild the Judge0 host from a clean image before grading resumes. Rotate `JUDGE0_AUTH_TOKEN`.
4. If hidden tests may have leaked, consider replacing the affected questions for future exams.

## Data leak

1. Contain it: revoke access (end sessions, rotate `JWT_SECRET` to end every session, rotate
   database passwords).
2. Work out what leaked from the audit log, server logs and the database's own logs.
3. Inform the institution's data-protection officer the same day. They decide on notifying
   students.

## Corrupted or wrong results

1. Hide results from students: Results tab → "Hide from students", with a reason.
2. Find the cause. Published versions are immutable snapshots, so compare the published version
   with current marks (the Results tab shows "Marks have changed since version N").
3. Fix the marks with reasons, save a new version, check the CSV, and publish it.
4. If the database itself is damaged, restore the last good backup into a new database and
   compare it ([backup and restore](backup-restore.md)).
