# Rehearsal plan: the mock exam before any graded exam

One full run of a real-sized lab exam with no marks at stake. It tests the server, the lab PCs,
the network and the people together, and it is the last gate on the
[pilot readiness checklist](../ops/pilot-readiness.md).

## Who and what

- **Room:** the lab used for the real exam, with every PC that will be used.
- **Students:** volunteers or a real class, ideally as many as the biggest exam. Tell them it's a
  practice run and nothing counts.
- **Staff:** one host at the staff PC, one invigilator per 30 students, the server admin on call,
  and one person with this plan who writes down times and problems.
- **Exam:** 45 minutes, two easy questions in all allowed languages, five submissions per
  question, verdicts shown, and **Students can finish early** ticked.

## The week before

- [ ] Server set up per the [deployment guide](../../deploy/README.md); load test passed on the
      lab network.
- [ ] Every lab PC installed and checked per the [lab PC guide](lab-pc-install.md).
- [ ] Mock exam created, students imported, PIN slips printed and cut.
- [ ] Staff accounts created; the invigilators have signed in once and read the
      [invigilator sheet](invigilator-sheet.md).
- [ ] Students got the [quick start](student-quick-start.md).
- [ ] Backup taken; restore drill done on this server.

## On the day

| Time | Step                                                                                        | Who         |
| ---- | ------------------------------------------------------------------------------------------- | ----------- |
| −30  | Take a backup on the server. Host opens the Live tab. Invigilators check a few PCs.         | Admin, all  |
| −15  | Students arrive, sign in with their slips, and wait on "Before you start".                  | Students    |
| −10  | **Drill 1:** one volunteer types a wrong PIN 5 times; the invigilator resets it.            | Invigilator |
| −5   | Host checks the Live tab: everyone **Not started**, nobody flagged. Note anyone missing.    | Host        |
| 0    | **Start exam.** Note the time every student is working.                                     | Host        |
| +5   | **Drill 2:** pull the network cable on one PC for 2 minutes, then plug it back in.          | Invigilator |
| +10  | **Drill 3:** hard-restart another PC. The student signs in again on the same or a spare PC. | Invigilator |
| +20  | **Drill 4:** restart the API (`docker compose … restart api`) during the exam.              | Admin       |
| +25  | **Drill 5:** host pauses for 2 minutes, announces, then resumes.                            | Host        |
| +30  | **Drill 6:** one student finishes, then the invigilator lets them back in.                  | Invigilator |
| +40  | Announce "5 minutes left; submit now".                                                      | Host        |
| +45  | Wait for every student to finish, then **End exam**.                                        | Host        |
| +50  | Take a backup on the server.                                                                | Admin       |

During each drill, the observer writes down what the student saw and how long recovery took.

**Expected:**

- Drill 1: **PIN locked** on the Live tab; the new PIN works.
- Drill 2: "Offline since …" on the PC, **Disconnected** on the Live tab, no work lost after
  reconnecting.
- Drill 3: the student's saved code comes back after signing in again.
- Drill 4: students see at most a short offline notice; nothing lost.
- Drill 5: every timer stops while paused, and the announcement appears on every screen within
  about 15 seconds.
- Drill 6: the student returns to their work with their original deadline.

## Straight afterwards: reconcile

Fill in the numbers from the Live and Results tabs and the CSV export:

| Check                                                            | Expected             | Actual |
| ---------------------------------------------------------------- | -------------------- | ------ |
| Registered students                                              | the class list       |        |
| Students who started                                             | everyone present     |        |
| Students with at least one submission                            | everyone who started |        |
| Submissions waiting to grade                                     | 0                    |        |
| Submissions that **couldn't grade**                              | 0                    |        |
| Grading caught up after the last submission within               | 2 minutes            |        |
| Marks in the CSV match the Results tab                           | yes                  |        |
| Finalize, publish; a student sees it with **Check my result**    | yes                  |        |
| Server logs: `judge_queue_alert` or `database_unavailable` lines | none (or explained)  |        |

Ask three or four students and every invigilator what confused them. Write it down word for word.

## Go / no-go

Go to the first graded exam only if:

- [ ] Every drill recovered with no lost work.
- [ ] Every reconcile row matches.
- [ ] No unexplained errors in the server logs.
- [ ] No student or invigilator confusion that would change a mark.
- [ ] The incident contact and the paper fallback are confirmed for the real exam.

Record the result, the date and who decided in the pilot readiness checklist. If anything failed,
fix it and repeat the drills that failed before the graded exam.
