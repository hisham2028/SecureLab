# Invigilator sheet

Print this and keep it in the exam room with the
[incident runbook](../ops/incident-response.md).

**Before students arrive**

- Sign in to the dashboard on the room's staff PC and open the exam's **Live** tab.
- Check that you have the PIN slips, the incident contact's phone number, and a paper fallback.
- On two or three lab PCs, open SecureLab and check that the sign-in screen appears.

**Signing in**

- Hand each student their slip. They type the exam code, student ID and PIN.
- **Locked PIN** (5 wrong tries): Students tab → **Reset PIN** → read the new PIN to the student
  or write it on their slip.
- **ID not accepted**: check the slip against the student's card. If they aren't registered, call
  the host; only a host can add a student.

**During the exam**

| You see or hear                          | Do this                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A PC crashes or freezes                  | Move the student to a spare PC. They sign in again; their work comes back. Add a note on their seat.              |
| A student shows **Disconnected**         | Check their network cable. They can keep typing; work is saved on the PC.                                         |
| **Second PC sign-in** flag               | Check where the student is sitting. Someone else may have their slip.                                             |
| **Left window** count                    | Look, don't act on it alone. It isn't misconduct by itself.                                                       |
| You see cheating                         | Write what you saw as a note on the seat. **Block** only if needed, with a reason; their work and clock are kept. |
| A student finished by mistake            | Open their seat → **Let back in**. Ask the host for extra time if it's fair.                                      |
| Whole room offline or the server is down | **Pause** the exam, call the incident contact, follow the runbook.                                                |
| A student says AI help isn't answering   | Tell them to carry on without it. A failed answer doesn't use up a question. Mention it to the host.              |
| Everyone needs to know something         | **Announce**. It reaches all screens within 15 seconds and can't be undone.                                       |

Extra time and ending the exam are done by the host. Every action asks for a reason; write
something a colleague could understand later.

**At the end**

- Make sure every student has left SecureLab before they leave the room.
- Students keep their PIN slips: they need the PIN to check their result later.
- Write any incident as a note on the student's seat before you sign out.
