# Data classification, monitoring and retention

- Status: Draft for the institution's approval (roadmap Phase 6 exit gate: "Institution approves
  data handling and monitoring practices")
- Date: 2026-11-18

SecureLab keeps only what is needed to run an exam, mark it fairly and settle disputes about it.
This page lists what is stored, who can see it and how long it is kept. The retention periods
are proposals. The institution's records or data-protection officer must confirm them before
the pilot.

## What is stored

| Data                                                                                                                       | Class                        | Who can see it                                                              | Kept for (proposal)                                                                                 | How it's removed                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Staff accounts (name, email, role, password hash)                                                                          | Personal                     | Admins                                                                      | While employed; deactivate on leaving                                                               | Admin deactivates; deletion on request              |
| Students (university ID, name)                                                                                             | Personal                     | Staff of the institution                                                    | As long as any of their exam records are kept                                                       | With their exam records                             |
| PINs                                                                                                                       | Credential                   | Nobody; only a hash is stored. The PIN slip is shown once at import         | Until the exam is archived                                                                          | Hash is useless after archive                       |
| Submitted code, drafts, runs' output, compiler output, test results                                                        | Assessment record            | Hosts and admins (review); the student sees their own                       | Same as other assessment records at the institution (often one year after the appeal window closes) | Database deletion per exam; backups age out         |
| Marks, manual changes with reasons, published results                                                                      | Assessment record            | Hosts and admins; the student sees their own published result               | Same as other assessment records                                                                    | As above                                            |
| Incident notes                                                                                                             | Assessment record, sensitive | All staff on the exam                                                       | Same as other assessment records                                                                    | As above                                            |
| Monitoring signals: online/offline, reconnects, window focus changes, second sign-ins, the question and language on screen | Monitoring, personal         | All staff on the exam, during and after                                     | **90 days after the exam ends** (`MONITORING_RETENTION_DAYS`)                                       | `pnpm --filter @securelab/api retention`, run daily |
| AI help exchanges: the student's question, the code sent with it, the answer, mode, model and time                         | Assessment record            | Hosts and admins; invigilators see only a count; the student sees their own | **365 days after the exam ends** (`AI_RETENTION_DAYS`)                                              | `pnpm --filter @securelab/api retention`, run daily |
| Audit log (who did what, when, from which role)                                                                            | Security record              | Admins, via the database                                                    | Same as assessment records; needed to answer disputes                                               | Database deletion per exam                          |
| Application logs (IDs, verdicts, timings; never code or test data)                                                         | Operational                  | Operators                                                                   | 30 days                                                                                             | Log rotation on the server                          |
| Backups                                                                                                                    | Copy of all of the above     | Operators                                                                   | 30 daily backups, then deleted                                                                      | Backup rotation (see backup runbook)                |
| Judge0's own database (submitted source and inputs)                                                                        | Copy of code                 | Operators                                                                   | Shortest Judge0 allows; set its cleanup to 1 day                                                    | Judge0 cleanup setting                              |

SecureLab does not collect:

- screen recordings or screenshots
- camera or microphone
- keystrokes
- clipboard contents
- browsing history
- the list of other running apps
- location

## Monitoring signals: what they are for

The signals help an invigilator see when a student needs help, for example when the network
has dropped. They also give context if an incident is reported. They are not evidence of
misconduct on their own:

- A dropped connection is almost always the network. The student keeps working, and their work
  is saved on the PC.
- Leaving the window can be a misclick, an operating-system dialog or a crash. The dashboard
  says so next to the count.
- A second sign-in for the same seat is the only signal flagged as a warning. Even then, the
  system takes no action by itself: only a person can block a seat, and only with a written
  reason that is audited.

## AI help

AI help is off unless the server has a model set up and the teacher turns it on for an exam and
question. By default the model runs on the exam server itself (Ollama, see the
[deployment guide](../../deploy/README.md#6-ai-help-optional-free)), so nothing leaves the
institution. The model is sent the visible question, the student's current code and their
question. It is never sent the student's name or ID, hidden tests or marks. Every exchange is
stored, can't be edited, and is deleted with the retention job after `AI_RETENTION_DAYS`.

If `AI_BASE_URL` points at a hosted service instead, students' code and questions go to that
provider and fall under its terms, which may allow it to keep or train on them. The institution
must approve that before any exam uses it. See [ADR 0008](../adr/0008-ai-help.md).

## Telling students

The student app shows, before the exam starts and before the student confirms they've read the
rules, what the exam staff can see:

- their code, runs and submissions, and the question and language they have open
- if a question allows AI help: what they ask, the code sent with it, and the answer
- whether the PC is connected
- when the app stops being the active window

It also says what is not recorded and that connection and window records are deleted after the
retention period. The institution should add the same text to the course's exam information.

## Access

Staff only see exams of their own institution. Invigilators see the live room but not code,
marks or results. Every staff action on a student is in the audit log. Students can only see
their own seat and, after publication, their own result.

## Retention job

```sh
# Count what would be deleted
pnpm --filter @securelab/api retention -- --dry-run
# Delete (schedule daily)
pnpm --filter @securelab/api retention
```

The job deletes monitoring signals and the live presence fields (last seen, current question and
language, session ID) of exams that ended more than `MONITORING_RETENTION_DAYS` ago. It writes a
`retention.monitoring_purged` audit row. It also deletes AI help exchanges of exams that ended
more than `AI_RETENTION_DAYS` ago (`retention.ai_purged`). It does not touch code, marks, results, incident notes
or the audit log; those follow the institution's assessment-records schedule.

## For the institution to decide

1. The assessment-records retention period: code, marks, results and audit log.
2. Whether to allow AI help at all, whether 365 days is right for its records, and that it stays
   on the institution's own server.
3. Whether 90 days is right for monitoring signals. It should be at least as long as the appeal
   window.
4. Who at the institution may ask for exports or deletion, and how students make such requests.
5. Where the server and backups live, and who operates them.
