"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/holdings", label: "Holdings" },
  { href: "/funds", label: "Funds" },
  { href: "/markets", label: "Markets" },
  { href: "/global", label: "Global" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const onLogin = pathname === "/login";
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, enabled: !onLogin });

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) router.replace("/login");
  }, [unauthenticated, router]);

  if (onLogin) return <main className="shell">{children}</main>;

  async function logout() {
    await api.logout();
    qc.clear();
    router.replace("/login");
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">kairo</Link>
        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={pathname === n.href ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="who">
          {me.data?.mode === "demo" && <span className="badge">Demo</span>}
          {me.data?.user && <span className="name">{me.data.user.name}</span>}
          {me.data?.mode === "kite" && (
            <button className="btn-quiet" onClick={logout}>Sign out</button>
          )}
        </div>
      </header>
      <main>{me.isSuccess ? children : null}</main>
    </div>
  );
}
