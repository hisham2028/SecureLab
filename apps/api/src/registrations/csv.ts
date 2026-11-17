import { parse } from "csv-parse/sync";

export interface CsvRow {
  /** 1-based line number in the file as the host sees it (header is line 1). */
  line: number;
  studentId: string;
  fullName: string;
}

export interface CsvError {
  line: number;
  message: string;
}

const ID_HEADERS = ["student_id", "studentid", "id", "student id"];
const NAME_HEADERS = ["name", "full_name", "fullname", "student name", "full name"];

/**
 * Parses registration CSV. Every cell is read as text, so "00123" stays "00123".
 * Accepts a UTF-8 BOM (Excel) and common header spellings.
 */
export function parseRegistrationCsv(text: string): { rows: CsvRow[]; errors: CsvError[] } {
  let records: string[][];
  try {
    records = parse(text.replace(/^\uFEFF/, ""), {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as string[][];
  } catch (err) {
    const line = (err as { lines?: number }).lines ?? 1;
    return {
      rows: [],
      errors: [{ line, message: "This file isn't valid CSV. Check for unmatched quotes." }],
    };
  }
  if (records.length === 0)
    return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };

  const header = records[0].map((h) => h.toLowerCase());
  const idCol = header.findIndex((h) => ID_HEADERS.includes(h));
  const nameCol = header.findIndex((h) => NAME_HEADERS.includes(h));
  if (idCol < 0 || nameCol < 0) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: 'The first row must be a header with "student_id" and "name" columns.',
        },
      ],
    };
  }

  const rows: CsvRow[] = [];
  const errors: CsvError[] = [];
  records.slice(1).forEach((rec, i) => {
    const line = i + 2;
    const studentId = rec[idCol] ?? "";
    const fullName = rec[nameCol] ?? "";
    if (!studentId) errors.push({ line, message: "Student ID is empty." });
    else if (!fullName) errors.push({ line, message: "Name is empty." });
    else if (fullName.length > 200)
      errors.push({ line, message: "Name is longer than 200 characters." });
    else rows.push({ line, studentId, fullName });
  });
  if (rows.length + errors.length > 2000) {
    return { rows: [], errors: [{ line: 1, message: "Import at most 2000 students at a time." }] };
  }
  return { rows, errors };
}
