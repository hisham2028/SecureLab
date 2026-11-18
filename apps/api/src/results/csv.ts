/**
 * CSV for spreadsheets. Cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR)
 * are prefixed with an apostrophe, so a student named "=HYPERLINK(...)" stays plain text.
 * Numbers are written as they are.
 */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) || v !== value ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvLine(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}
