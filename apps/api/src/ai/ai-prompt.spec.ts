import { buildAiMessages, cleanAiReply, MAX_AI_CODE_CHARS } from "./ai-prompt";

const question = {
  title: "Sum",
  statement: "Read two integers and print their sum.",
  inputFormat: "Two integers a and b.",
  outputFormat: "a + b",
  constraints: "",
  samples: [{ input: "1 2\n", expectedOutput: "3\n" }],
};

describe("buildAiMessages", () => {
  const base = {
    mode: "HINTS_ONLY" as const,
    language: "c" as const,
    question,
    history: [],
    code: "int main(){}",
    prompt: "Why does it print nothing?",
  };

  it("puts the rules, the mode and the visible question in the system message", () => {
    const [system, user] = buildAiMessages(base);
    expect(system.role).toBe("system");
    expect(system.content).toContain("HINTS ONLY");
    expect(system.content).toContain("Read two integers");
    expect(system.content).toContain("Example 1");
    expect(system.content).toContain("writing C.");
    expect(user.role).toBe("user");
    expect(user.content).toContain("int main(){}");
    expect(user.content).toContain("My question: Why does it print nothing?");
  });

  it("says full assistance is allowed only in FULL mode", () => {
    const [system] = buildAiMessages({ ...base, mode: "FULL" });
    expect(system.content).toContain("FULL ASSISTANCE");
    expect(system.content).not.toContain("HINTS ONLY");
  });

  it("keeps the last four earlier exchanges as conversation", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ prompt: `q${i}`, reply: `a${i}` }));
    const msgs = buildAiMessages({ ...base, history });
    expect(msgs.map((m) => m.content).slice(1, 9)).toEqual([
      "q2",
      "a2",
      "q3",
      "a3",
      "q4",
      "a4",
      "q5",
      "a5",
    ]);
    expect(msgs).toHaveLength(10);
  });

  it("cuts very long code", () => {
    const msgs = buildAiMessages({ ...base, code: "x".repeat(MAX_AI_CODE_CHARS + 50) });
    const last = msgs[msgs.length - 1].content;
    expect(last).toContain("(the rest was cut)");
    expect(last.length).toBeLessThan(MAX_AI_CODE_CHARS + 500);
  });

  it("sends a note instead of an empty code block", () => {
    const msgs = buildAiMessages({ ...base, code: "  " });
    expect(msgs[msgs.length - 1].content).toContain("(empty)");
  });
});

describe("cleanAiReply", () => {
  const solution =
    'Here you go:\n```c\n#include <stdio.h>\nint main(void){\n  int a,b;\n  scanf("%d %d",&a,&b);\n  printf("%d\\n",a+b);\n}\n```\nGood luck.';

  it("removes code blocks from hints", () => {
    const r = cleanAiReply(solution, "HINTS_ONLY");
    expect(r.filtered).toBe(true);
    expect(r.text).not.toContain("scanf");
    expect(r.text).toContain("hints only");
    expect(r.text).toContain("Good luck.");
  });

  it("removes an unclosed code block too", () => {
    const r = cleanAiReply("Try this:\n```\na = 1\nb = 2\nprint(a + b)\n", "HINTS_ONLY");
    expect(r.filtered).toBe(true);
    expect(r.text).not.toContain("print(a + b)");
  });

  it("removes indented code", () => {
    const r = cleanAiReply(
      "Like this:\n\n    a = int(x)\n    b = int(y)\n    print(a + b)\n\nDone.",
      "HINTS_ONLY",
    );
    expect(r.filtered).toBe(true);
    expect(r.text).not.toContain("print(a + b)");
  });

  it("keeps a one-line quote of the student's code", () => {
    const r = cleanAiReply(
      'Look at this line:\n```c\nscanf("%d", a);\n```\nIt needs &a.',
      "HINTS_ONLY",
    );
    expect(r.filtered).toBe(false);
    expect(r.text).toContain("scanf");
  });

  it("leaves code alone in full mode", () => {
    const r = cleanAiReply(solution, "FULL");
    expect(r.filtered).toBe(false);
    expect(r.text).toContain("scanf");
  });

  it("drops thinking sections", () => {
    const r = cleanAiReply("<think>the answer is a+b</think>Check how you read the input.", "FULL");
    expect(r.text).toBe("Check how you read the input.");
  });
});
