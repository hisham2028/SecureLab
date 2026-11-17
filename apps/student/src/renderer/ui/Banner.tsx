import type { ReactNode } from "react";

export function Banner({
  tone,
  children,
}: {
  tone: "danger" | "warning" | "info" | "success";
  children: ReactNode;
}) {
  return (
    <div className={`banner ${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </div>
  );
}
