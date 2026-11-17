import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import type { QuestionSummary } from "../api";
import { navigate } from "../router";
import { ErrorBanner, LANGUAGE_LABEL, Pagination } from "../ui/bits";

const PAGE_SIZE = 20;
const DIFFICULTY = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" } as const;

export function QuestionsList() {
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.listQuestions().then(setQuestions, setError);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (questions ?? []).filter(
      (x) =>
        x.archived === (show === "archived") &&
        (!q ||
          x.title.toLowerCase().includes(q) ||
          x.topic.toLowerCase().includes(q) ||
          x.tags.some((t) => t.includes(q))),
    );
  }, [questions, query, show]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Question bank</h1>
          <p className="muted">
            Every edit saves a new version. Exams keep the version they were built with.
          </p>
        </div>
        <a className="btn btn-primary" href="#/questions/new">
          New question
        </a>
      </header>
      <div className="toolbar">
        <label className="search">
          <span>Search</span>
          <input
            type="search"
            placeholder="Title, topic or tag"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="filter">
          <span>Show</span>
          <select
            value={show}
            onChange={(e) => {
              setShow(e.target.value as "active" | "archived");
              setPage(1);
            }}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>
      <ErrorBanner error={error} />
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Topic</th>
              <th scope="col">Difficulty</th>
              <th scope="col">Languages</th>
              <th scope="col">Tags</th>
              <th scope="col" className="num">
                Tests
              </th>
              <th scope="col" className="num">
                Version
              </th>
            </tr>
          </thead>
          <tbody>
            {questions === null && !error && (
              <tr>
                <td colSpan={7} className="empty">
                  Loading questions…
                </td>
              </tr>
            )}
            {questions !== null && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  {questions.filter((q) => !q.archived).length === 0 && show === "active" ? (
                    <>
                      <strong>No questions yet.</strong>{" "}
                      <a href="#/questions/new">Write your first question</a>
                    </>
                  ) : (
                    "No questions match."
                  )}
                </td>
              </tr>
            )}
            {rows.map((q) => (
              <tr key={q.id} className="row-link" onClick={() => navigate(`/questions/${q.id}`)}>
                <td>
                  <a href={`#/questions/${q.id}`} onClick={(e) => e.stopPropagation()}>
                    {q.title}
                  </a>
                </td>
                <td>{q.topic || "—"}</td>
                <td>{DIFFICULTY[q.difficulty]}</td>
                <td>{q.allowedLanguages.map((l) => LANGUAGE_LABEL[l]).join(", ")}</td>
                <td>{q.tags.join(", ") || "—"}</td>
                <td className="num">{q.testCaseCount}</td>
                <td className="num">v{q.latestVersion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} total={filtered.length} onPage={setPage} />
    </div>
  );
}
