import type { ReactNode } from "react";

/** Page title with the brand's faint closing stop, and an optional meta line. */
export function PageTitle({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="page-title">
      <h1>
        {title}
        <span className="stop" aria-hidden>.</span>
      </h1>
      {meta && <div className="muted">{meta}</div>}
    </div>
  );
}
