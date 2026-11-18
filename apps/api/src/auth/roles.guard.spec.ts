import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";

function ctxWith(role?: string): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role, kind: "staff" } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it("allows any authenticated user when no roles are required", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
    await expect(guard.canActivate(ctxWith("HOST"))).resolves.toBe(true);
  });

  it("rejects a user without a required role", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["ADMIN"]);
    await expect(guard.canActivate(ctxWith("HOST"))).rejects.toThrow(ForbiddenException);
  });

  it("accepts a user with a required role", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["ADMIN", "HOST"]);
    await expect(guard.canActivate(ctxWith("HOST"))).resolves.toBe(true);
  });
});
