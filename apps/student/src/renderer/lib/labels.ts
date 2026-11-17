import type { Language, SubmissionStatus, Verdict } from "@securelab/shared";

export const LANGUAGE_LABEL: Record<Language, string> = {
  c: "C",
  cpp: "C++",
  python: "Python 3",
};

/** Starting code for a language the student hasn't written anything in yet. */
export const STARTER: Record<Language, string> = {
  c: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n",
  cpp: "#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n",
  python: "# Read the input with input() and print your answer.\n\n",
};

/** What a "Run" result means. There's no expected output, so "accepted" just means it ran. */
export const RUN_LABEL: Record<Verdict, string> = {
  QUEUED: "Waiting to run",
  RUNNING: "Running",
  ACCEPTED: "Finished",
  WRONG_ANSWER: "Finished",
  COMPILE_ERROR: "Didn't compile",
  RUNTIME_ERROR: "Stopped with an error",
  TIME_LIMIT_EXCEEDED: "Took too long",
  MEMORY_LIMIT_EXCEEDED: "Used too much memory",
  INTERNAL_ERROR: "The judge had a problem. Try again.",
  PARTIAL: "Finished",
};

export const SUBMISSION_LABEL: Record<SubmissionStatus, string> = {
  QUEUED: "Received, waiting for grading",
  RUNNING: "Being graded",
  GRADED: "Graded",
  PARTIAL: "Some tests passed",
  ACCEPTED: "Accepted",
  WRONG_ANSWER: "Wrong answer",
  COMPILE_ERROR: "Compile error",
  RUNTIME_ERROR: "Runtime error",
  TIME_LIMIT_EXCEEDED: "Time limit exceeded",
  MEMORY_LIMIT_EXCEEDED: "Memory limit exceeded",
  INTERNAL_ERROR: "Grading problem on our side (not your code). The invigilator can re-run it.",
};

export const timeOf = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";
