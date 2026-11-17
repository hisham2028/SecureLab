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

  it("allows any authenticated user when no roles are required", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
    expect(guard.canActivate(ctxWith("HOST"))).toBe(true);
  });

  it("rejects a user without a required role", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["ADMIN"]);
    expect(() => guard.canActivate(ctxWith("HOST"))).toThrow(ForbiddenException);
  });

  it("accepts a user with a required role", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["ADMIN", "HOST"]);
    expect(guard.canActivate(ctxWith("HOST"))).toBe(true);
  });
});
