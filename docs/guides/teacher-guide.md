# Teacher guide: running an exam in SecureLab

For hosts and admins. Invigilators in the room need only the
[invigilator sheet](invigilator-sheet.md).

Sign in to the dashboard at the address your admin gave you, such as
`https://exam.cse.example.edu`. The menu has **Exams**, **Questions** and, for admins,
**Staff**. Every action that changes a student's exam asks for a reason and goes into the audit
log.

## Who can do what

| Role        | Can                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Admin       | Everything, including adding staff on the **Staff** page                                                    |
| Host        | Questions, exams, students, extra time, marks and results                                                   |
| Invigilator | The Live tab: pause and resume, announcements, block and unblock, let a student back in, reset a PIN, notes |

## 1. Write the questions (days before)

**Questions → New question**:

- **Problem statement, input format, output format, constraints**: what students read.
- **Languages**: C, C++ and Python. The exam can narrow this further, never widen it.
- **Time limit** (0.1 to 15 seconds) and **memory limit** (16 to 512 MB) per run.
- **Test cases.** Tick **Hidden** for tests used for marking. Untick it for samples, which
  students can see. Give each hidden test a **weight**.
- **Scoring**: _Partial marks by test weight_ or _All tests must pass_.
- **Output check**: _Exact match_, or _Ignore trailing spaces and blank lines_ (kinder for most
  lab exercises).
- **AI help**: leave **Off**. AI assistance isn't available to students in the pilot.

Solve each question yourself in every allowed language before the exam. A question with no hidden
test can't be published.

## 2. Create the exam

**Exams → New exam**, then **Edit settings**:

- **Duration** and **Late entry** (how long after the start students can still sign in).
- **Student ID format**: length, digits or letters, prefix and separators. Type a real ID under
  **Try an ID** to check it. Leading zeros are kept.
- **Question order**: _Any order_, or _One after another_ (students can't go back).
- **Submissions per question**: the most each student may submit. Their best graded submission
  counts.
- **Students can finish early** and **Show verdicts during the exam** (students see "Accepted"
  or "Wrong answer" and how many hidden tests passed, never marks).
- **Instructions for students**: shown on their screen before the start.

**Questions tab → Choose questions from the bank**, set the **points** for each and order them.

## 3. Add students and print PIN slips

**Students tab → Import CSV**. The file needs a header row with `student_id` and `name`:

```csv
student_id,name
2201234,Ayesha Rahman
2201235,Tanvir Hasan
```

Rows with problems are listed with the reason; fix the file and import again. Add a late
registration with **Add student**.

Right after importing, open **PIN slips** and **Print**. PINs are shown only once and are kept
only in that browser tab. If you lose them, use **New PINs for everyone** on the PIN slips page
(every earlier PIN stops working), or **Reset PIN** for one student on the Students tab.

Cut the slips and keep them with the exam papers. Each slip has the exam code, student ID and
PIN.

## 4. Publish (the day before or that morning)

**Publish** locks the questions. Students can now sign in and read the instructions, but they
can't see any question until you start. You can still **Unpublish** if you spot a mistake.

Give students who need it **Extra time** on the Students tab now, with a reason (for example an
approved accommodation). It adds to their own deadline only.

## 5. Run the exam

1. Students sign in with their slip and wait on the "Before you start" screen. The Live tab shows
   them as **Not started**.
2. Press **Start exam**. The clock starts for everyone at once and registration locks.
3. Watch the **Live** tab. It updates by itself and shows each student's status, connection and
   the question they're on. The **Needs a look** column flags a locked PIN, a sign-in from a second
   PC, and how often a student left the exam window.
4. To tell everyone something, use **Announce**. It reaches every screen within about 15 seconds
   and can't be taken back.
5. If something goes wrong for the whole room, press **Pause**. Every clock stops and editing is
   off until you press **Resume**.

Click a student to open their seat: timeline, submissions, notes, and the actions **Block**,
**Unblock**, **Let back in**, **Extra time** and **End this student's exam**.

"Left the exam window" and "Reconnected" are facts, not misconduct. Nothing happens to a student
automatically; only staff can block someone, always with a reason.

## 6. End the exam

When the time is up and every student has finished, press **End exam** and type `END`. Students
still working stop at once, including anyone with extra time, so wait for them first.

Only submitted code counts. If a student ran out of time with unsubmitted work, open their seat
and use **Submit saved drafts**. It submits each question's latest draft that differs from their
last submission, marked as submitted by staff.

## 7. Marks and results

The **Results** tab shows marks as grading finishes.

- **Couldn't grade** means the judge failed, not the student. Open the student and **Grade
  again**, or set the mark by hand.
- **Change mark** in a student's seat lets you set a mark or add rubric lines (for example
  "−2 Readable code"). Every change needs a reason and is kept in the history.
- When nothing is waiting, **Finalize results** saves version 1. **Publish** shows it to
  students; **Hide from students** takes it back. If you change marks later, **Save a new
  version** and publish that.
- **Export CSV** downloads the marks for your records.

Students check their published result in the SecureLab app with **Check my result** on the
sign-in screen, using the same exam code, student ID and PIN.

**Archive** the exam when you're done. It becomes read-only.

## If something goes wrong

| What you see                                | What to do                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| A student's PIN is locked (5 wrong tries)   | **Reset PIN** on the Students tab and give them the new PIN.                          |
| A student's PC crashed                      | They sign in again on any lab PC. Their saved work comes back.                        |
| A student finished by mistake               | **Let back in** on their seat. Their deadline stays; add **Extra time** if fair.      |
| "Grading is running behind" on the Live tab | Keep the exam going; submissions are queued safely. Tell your admin.                  |
| The server is unreachable for everyone      | **Pause** if you can, and follow the [incident runbook](../ops/incident-response.md). |
