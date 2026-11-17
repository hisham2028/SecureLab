/** Platform roles. Students are never staff users; they hold per-exam attempts. */
export const StaffRole = {
  Admin: "ADMIN",
  Host: "HOST",
  Invigilator: "INVIGILATOR",
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];
