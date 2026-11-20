"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { IconMarkets, IconPortfolio, IconScreener, IconSignOut, IconToday, IconWatch } from "./Icons";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { Loading } from "./States";
import { ThemeToggle } from "./ThemeToggle";

export const NAV = [
  { href: "/", label: "Today", Icon: IconToday, match: (p: string) => p === "/" },
  { href: "/portfolio", label: "Portfolio", Icon: IconPortfolio, match: (p: string) => p.startsWith("/portfolio") },
  { href: "/markets", label: "Markets", Icon: IconMarkets, match: (p: string) => p.startsWith("/markets") },
  { href: "/screener", label: "Screener", Icon: IconScreener, match: (p: string) => p.startsWith("/screener") },
  { href: "/watch", label: "Watch", Icon: IconWatch, match: (p: string) => p.startsWith("/watch") },
];

/** Desktop nav with an ink pill that slides to the active item. */
function TopNav({ pathname }: { pathname: string }) {
  const ref = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const active = NAV.findIndex((n) => n.match(pathname));

  useLayoutEffect(() => {
    const el = ref.current?.querySelectorAll<HTMLAnchorElement>("a")[active];
    setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
  }, [active]);

  return (
    <nav className="nav" aria-label="Primary" ref={ref}>
      <span className="nav-pill" aria-hidden style={{ transform: `translateX(${pill?.x ?? 0}px)`, width: pill?.w ?? 0, opacity: pill ? 1 : 0 }} />
      {NAV.map((n, i) => (
        <Link key={n.href} href={n.href} aria-current={i === active ? "page" : undefined}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

function BottomBar({ pathname }: { pathname: string }) {
  return (
    <nav className="bottombar" aria-label="Primary">
      {NAV.map(({ href, label, Icon, match }) => (
        <Link key={href} href={href} aria-current={match(pathname) ? "page" : undefined}>
          <span className="ic"><Icon /></span>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const qc = useQueryClient();
  const onLogin = pathname === "/login";
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, enabled: !onLogin });

  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) router.replace("/login");
  }, [unauthenticated, router]);

  if (onLogin) return <main className="shell">{children}</main>;

  async function logout(everywhere: boolean) {
    await (everywhere ? api.logoutAll() : api.logout());
    qc.clear();
    router.replace("/login");
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/" className="brand" aria-label="Kairo home">
            <Logo height={20} />
          </Link>
          <TopNav pathname={pathname} />
          <div className="tools">
            <button type="button" className="search-btn" onClick={() => setPalette(true)} aria-label="Search (⌘K)">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13 13 4 4" /></svg>
              <span className="t">Search</span>
              <kbd>⌘K</kbd>
            </button>
            {me.data?.mode === "demo" && <span className="badge">Demo</span>}
            <ThemeToggle />
            {me.data?.mode === "kite" && (
              <details className="who menu">
                <summary aria-label="Account">
                  <span className="name">{me.data.user?.name}</span>
                  <span className="initial" aria-hidden>{me.data.user?.name?.[0] ?? "·"}</span>
                  <span className={`kite-dot ${me.data.kite?.connected ? "on" : ""}`} title={me.data.kite?.connected ? "Kite connected" : "Kite disconnected"} />
                </summary>
                <div className="menu-panel" role="menu">
                  <p className="sub" style={{ margin: "0 0 6px" }}>
                    {me.data.kite?.connected ? "Kite connected until 6 AM" : "Kite disconnected"}
                  </p>
                  <a role="menuitem" href="/api/auth/login">{me.data.kite?.connected ? "Refresh Kite connection" : "Reconnect Kite"}</a>
                  <button role="menuitem" type="button" onClick={() => logout(false)}>
                    <IconSignOut /> Sign out
                  </button>
                  <button role="menuitem" type="button" onClick={() => logout(true)}>Sign out on all devices</button>
                </div>
              </details>
            )}
          </div>
        </div>
      </header>
      {me.data?.mode === "kite" && me.data.kite && !me.data.kite.connected && (
        <div className="notice" role="status">
          <span>Kite is disconnected. Holdings are from your last sync, valued at the latest NSE close and fund NAVs.</span>
          <a href="/api/auth/login" className="btn">Reconnect Kite</a>
        </div>
      )}
      {/* Keyed by path so each page fades in on navigation. */}
      <main key={pathname} className="page">
        {me.isSuccess ? children : <Loading rows={4} />}
      </main>
      <BottomBar pathname={pathname} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
