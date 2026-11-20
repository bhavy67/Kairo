import { ApiError } from "@/lib/api";

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%`, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

export function ErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : "Could not load data.";
  // No live token and no saved snapshot yet: the only useful action is to connect.
  if (error instanceof ApiError && error.code === "broker_disconnected") {
    return (
      <div className="card" role="status">
        <p style={{ margin: "0 0 12px" }}>{msg}</p>
        <a className="btn btn-primary" href="/api/auth/login">Connect Kite</a>
      </div>
    );
  }
  return (
    <div className="card error" role="alert">
      <p style={{ margin: "0 0 12px" }}>{msg}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}
