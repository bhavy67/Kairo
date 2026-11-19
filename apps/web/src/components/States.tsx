import { ApiError } from "@/lib/api";

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function ErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : "Could not load data.";
  return (
    <div className="card error" role="alert">
      <p style={{ margin: "0 0 12px" }}>{msg}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}
