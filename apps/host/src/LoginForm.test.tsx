import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginForm } from "./LoginForm";

describe("LoginForm", () => {
  it("shows the server's error message when sign-in fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Email or password is incorrect."));
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.edu" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Email or password is incorrect."),
    );
    expect(onSubmit).toHaveBeenCalledWith("a@b.edu", "x");
  });
});
