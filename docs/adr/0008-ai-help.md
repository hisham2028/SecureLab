# ADR 0008: AI help during exams

- Status: Accepted
- Date: 2026-11-18

## Context

The roadmap's MVP includes AI assistance that a teacher can switch off, limit to hints, or allow
in full, per exam and per question, with every exchange logged. The institution does not want a
paid AI service. Students' code and questions are exam records, so where they go matters as much
as the feature itself.

## Decision

**A free model on the institution's own server by default.** The API talks to any
OpenAI-compatible `chat/completions` endpoint (`AI_BASE_URL`, `AI_MODEL`, optional `AI_API_KEY`).
The deployment package includes [Ollama](https://ollama.com) as an optional service with
`qwen2.5-coder:7b`, a free, open-weights coding model that runs on the exam server's CPU (or a
GPU if there is one). Nothing leaves the server and there is no per-question cost. A hosted free
tier, or a paid service later, needs only those three settings. With `AI_BASE_URL` empty, AI help
is off everywhere and the dashboard says so.

**The server decides everything.** The mode for a question is the stricter of the exam's and the
question's setting (`effectiveAiMode`): Off beats Hints only beats Full. The student app only
shows what the server returns with the question and sends the student's text; it cannot change the
mode, the limit or what the model is told.

**The model sees only what the student can already see.** The prompt holds fixed rules, the mode's
rules, the question's title, statement, formats, constraints and visible samples, the last four
exchanges on that question, the student's current code (cut at 20,000 characters) and their
question. Hidden tests, marks, other students and the student's name or ID are never sent. The
rules tell the model to treat the question and code as material, not instructions.

**Hints only is enforced after the model answers, too.** A model can ignore its instructions, so
in hints-only mode any code block of more than two non-empty lines (fenced, left open, or
indented) is replaced with "[Code removed: this exam allows hints only.]" and the exchange is
stored as `FILTERED`. Staff see that it happened. "Thinking" sections some models print are
removed in every mode.

**Use is limited.** Each student gets `AI_QUESTIONS_PER_QUESTION` (default 10) per exam question;
failed calls don't count. A seat can have one question in flight, the server answers at most
`AI_MAX_CONCURRENT` (default 4) at once, and the route allows 6 requests a minute per student.
When the server is busy the student is told to try again; the exam itself is never slowed down,
because the model call runs outside any database transaction and has a timeout
(`AI_TIMEOUT_SECONDS`).

**Every exchange is kept and can't be edited.** `ai_exchanges` stores the seat, question, mode,
language, prompt, the code that was sent, the reply, status (`ANSWERED`, `FILTERED`, `FAILED`),
model and duration. A database trigger rejects updates. Hosts and admins can read a student's
conversation from the seat drawer; invigilators only see how many times AI help was used. The
student sees their own conversation for each question. The retention job deletes exchanges of
exams that ended more than `AI_RETENTION_DAYS` (default 365) ago.

**AI errors never look like the network.** The student app treats 502 to 504 as "offline", so AI
failures use 424 (`AI_UNAVAILABLE`, the model didn't answer), 403 (off for this question), 422
(not set up) and 429 (`AI_LIMIT`).

## Consequences

- A 7B model on CPU answers in roughly 10 to 60 seconds; the student app waits up to two minutes.
  For a big room, a GPU or a smaller model (`qwen2.5-coder:3b`) keeps answers quick. Teachers
  should try the model on their own questions before turning AI help on.
- The hints-only filter removes code but can't judge a long prose explanation that walks through
  the whole solution. Teachers who need certainty should use Off.
- Pointing `AI_BASE_URL` at a hosted service sends students' code and questions to that provider.
  The institution must approve that first (see [data and retention](../privacy/data-retention.md)).
