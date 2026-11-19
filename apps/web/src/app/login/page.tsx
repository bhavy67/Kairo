"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const ERRORS: Record<string, string> = {
  denied: "Login was cancelled or Kite did not return a token.",
  state: "The login link expired or was tampered with. Try again.",
  forbidden: "This Kite account is not allowed to use this Kairo instance.",
};

function LoginInner() {
  const error = useSearchParams()?.get("error");
  return (
    <div className="center">
      <div className="stack" style={{ maxWidth: 360 }}>
        <div className="brand" style={{ fontSize: 22 }}>kairo</div>
        <p className="muted" style={{ margin: 0 }}>Sign in with Zerodha Kite. The session lasts until 6 AM IST, when Kite expires every token.</p>
        {error && <p className="loss" role="alert" style={{ margin: 0 }}>{ERRORS[error] ?? "Login failed."}</p>}
        {/* A plain link, not fetch: the flow is a chain of top-level redirects. */}
        <a className="btn btn-primary" href="/api/auth/login" style={{ justifyContent: "center" }}>Sign in with Kite</a>
      </div>
    </div>
  );
}

export default function Login() {
  return <Suspense><LoginInner /></Suspense>;
}
