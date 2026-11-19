"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";

const ERRORS: Record<string, string> = {
  denied: "Login was cancelled or Kite did not return a token.",
  state: "The login link expired or was tampered with. Try again.",
  forbidden: "This Kite account is not allowed to use this Kairo instance.",
};

function LoginInner() {
  const error = useSearchParams()?.get("error");
  return (
    <div className="center">
      <div className="stack" style={{ maxWidth: 380, gap: 22 }}>
        <Logo height={30} />
        <div>
          <h1 style={{ fontSize: 34 }}>Your market desk<span className="stop">.</span></h1>
          <p className="muted" style={{ margin: "10px 0 0", fontSize: 14 }}>Sign in with Zerodha Kite. The session lasts until 6 AM IST, when Kite expires every token.</p>
        </div>
        {error && <p className="loss" role="alert" style={{ margin: 0 }}>{ERRORS[error] ?? "Login failed."}</p>}
        {/* A plain link, not fetch: the flow is a chain of top-level redirects. */}
        <a className="btn btn-primary" href="/api/auth/login" style={{ height: 44 }}>Sign in with Kite</a>
      </div>
    </div>
  );
}

export default function Login() {
  return <Suspense><LoginInner /></Suspense>;
}
