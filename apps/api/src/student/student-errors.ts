import { HttpException, HttpStatus } from "@nestjs/common";
import { StudentErrorCode } from "@securelab/shared";

/** An HTTP error with a machine-readable code the desktop client acts on. */
export function studentError(
  status: HttpStatus,
  code: StudentErrorCode,
  message: string,
  details?: unknown,
): HttpException {
  return new HttpException({ code, message, details }, status);
}
