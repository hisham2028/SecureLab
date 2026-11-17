import { useState } from "react";
import { allowedTransitions, ExamStatus } from "@securelab/shared";
import { LoginForm } from "./LoginForm";
import * as api from "./api";

export function App() {
  const [user, setUser] = useState<api.Me | null>(null);

  if (!user) {
    return (
      <main className="center">
        <LoginForm
          onSubmit={async (email, password) => {
            await api.login(email, password);
            setUser(await api.me());
          }}
        />
      </main>
    );
  }

  return (
    <div className="shell">
      <header>
        <strong>SecureLab</strong>
        <span>
          {user.displayName} · {user.role}
        </span>
        <button
          onClick={() => {
            api.logout();
            setUser(null);
          }}
        >
          Sign out
        </button>
      </header>
      <main>
        <h1>Examinations</h1>
        <p className="muted">
          Exam creation arrives in Phase 2. Lifecycle from Draft:{" "}
          {allowedTransitions(ExamStatus.Draft).join(", ")}.
        </p>
      </main>
    </div>
  );
}
