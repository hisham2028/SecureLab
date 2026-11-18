import { useEffect, useState } from "react";
import { LoginForm } from "./LoginForm";
import * as api from "./api";
import { useRoute } from "./router";
import { ExamsList } from "./pages/ExamsList";
import { ExamDetail } from "./pages/ExamDetail";
import { PinSheet } from "./pages/PinSheet";
import { QuestionsList } from "./pages/QuestionsList";
import { QuestionEditor } from "./pages/QuestionEditor";
import { StaffPage } from "./pages/StaffPage";
import { ChangePasswordDialog } from "./ui/ChangePasswordDialog";
import { Notice } from "./ui/bits";

export function App() {
  const [user, setUser] = useState<api.Me | null>(null);
  const [expired, setExpired] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const route = useRoute();

  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      api.logout();
      setUser(null);
      setExpired(true);
    });
  }, []);

  if (!user) {
    return (
      <main className="center">
        <LoginForm
          notice={expired ? "Your session ended. Sign in again to continue." : undefined}
          onSubmit={async (email, password) => {
            await api.login(email, password);
            setUser(await api.me());
            setExpired(false);
          }}
        />
      </main>
    );
  }

  const canManage = user.role === "ADMIN" || user.role === "HOST";
  const isAdmin = user.role === "ADMIN";
  const section = route.page.startsWith("question")
    ? "questions"
    : route.page === "staff"
      ? "staff"
      : "exams";

  return (
    <div className="shell">
      <header className="topbar no-print">
        <a className="brand" href="#/exams">
          SecureLab
        </a>
        <nav aria-label="Main">
          <a href="#/exams" aria-current={section === "exams" ? "page" : undefined}>
            Exams
          </a>
          {canManage && (
            <a href="#/questions" aria-current={section === "questions" ? "page" : undefined}>
              Question bank
            </a>
          )}
          {isAdmin && (
            <a href="#/staff" aria-current={section === "staff" ? "page" : undefined}>
              Staff
            </a>
          )}
        </nav>
        <span className="who">
          {user.displayName} · {user.role.toLowerCase()}
        </span>
        <button
          className="btn btn-sm"
          onClick={() => {
            setPasswordChanged(false);
            setChangingPassword(true);
          }}
        >
          Change password
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            api.logout();
            setUser(null);
          }}
        >
          Sign out
        </button>
      </header>
      <ChangePasswordDialog
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
        onChanged={() => {
          setChangingPassword(false);
          setPasswordChanged(true);
        }}
      />
      <main>
        {passwordChanged && (
          <div className="page no-print">
            <Notice tone="success">
              Password changed. You&apos;re still signed in here and signed out everywhere else.
            </Notice>
          </div>
        )}
        {route.page === "staff" && isAdmin && <StaffPage me={user} />}
        {route.page === "exams" && <ExamsList canCreate={canManage} />}
        {route.page === "exam" && (
          <ExamDetail key={route.id} id={route.id} tab={route.tab} me={user} />
        )}
        {route.page === "pins" && canManage && <PinSheet id={route.id} />}
        {route.page === "questions" && canManage && <QuestionsList />}
        {route.page === "question-new" && canManage && <QuestionEditor key="new" />}
        {route.page === "question-edit" && canManage && (
          <QuestionEditor key={route.id} id={route.id} />
        )}
        {(route.page === "not-found" ||
          (!isAdmin && route.page === "staff") ||
          (!canManage &&
            ["pins", "questions", "question-new", "question-edit"].includes(route.page))) && (
          <div className="page">
            <h1>Page not found</h1>
            <p>
              <a href="#/exams">Go to exams</a>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
