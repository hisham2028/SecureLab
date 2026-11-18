import type { Announcement } from "@securelab/shared";
import { timeOf } from "../lib/labels";

/** Invigilator announcements, newest first, until the student dismisses each one. */
export function Announcements({
  items,
  onDismiss,
}: {
  items: Announcement[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="announcements" role="status" aria-live="polite">
      {[...items].reverse().map((a) => (
        <div key={a.id} className="banner info announcement">
          <div>
            <strong>Announcement · {timeOf(a.createdAt)}</strong>
            <p>{a.message}</p>
          </div>
          <button type="button" onClick={() => onDismiss(a.id)}>
            Got it
          </button>
        </div>
      ))}
    </div>
  );
}
