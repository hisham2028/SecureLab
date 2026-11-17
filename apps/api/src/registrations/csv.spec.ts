import { parseRegistrationCsv } from "./csv";

describe("parseRegistrationCsv", () => {
  it("keeps leading zeros and handles a BOM and quoted names", () => {
    const { rows, errors } = parseRegistrationCsv('﻿student_id,name\n00123,"Rahman, Ayesha"\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ line: 2, studentId: "00123", fullName: "Rahman, Ayesha" }]);
  });

  it("reports row-level errors with file line numbers", () => {
    const { rows, errors } = parseRegistrationCsv("Student ID,Name\n001,A\n,B\n003,\n");
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([
      { line: 3, message: "Student ID is empty." },
      { line: 4, message: "Name is empty." },
    ]);
  });

  it("requires the header", () => {
    expect(parseRegistrationCsv("001,A\n").errors[0].line).toBe(1);
  });

  it("rejects malformed CSV without throwing", () => {
    expect(parseRegistrationCsv('student_id,name\n001,"broken\n').errors).toHaveLength(1);
  });
});
