import { SetMetadata } from "@nestjs/common";

export const IS_STUDENT_ROUTE = "isStudentRoute";
/**
 * Marks a route as student-only. Every other non-public route is staff-only, so a student
 * token can never reach host endpoints by accident.
 */
export const StudentRoute = () => SetMetadata(IS_STUDENT_ROUTE, true);
