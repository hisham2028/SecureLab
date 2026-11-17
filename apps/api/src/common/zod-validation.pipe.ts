import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      );
    }
    return parsed.data;
  }
}
