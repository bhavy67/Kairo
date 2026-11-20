"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

const PAGES = [
  { label: "Today", href: "/" },
  { label: "Holdings", href: "/portfolio" },
  { label: "Mutual funds", href: "/portfolio/funds" },
  { label: "Returns", href: "/portfolio/returns", hint: "XIRR, realised gains" },
  { label: "Plan", href: "/plan", hint: "goals, SIPs, allocation" },
  { label: "Markets · India", href: "/markets" },
  { label: "Markets · Global", href: "/markets/global" },
  { label: "Markets · Screener", href: "/markets/screener", hint: "stocks of the day" },
  { label: "Watchlist", href: "/watch" },
  { label: "Alerts", href: "/watch/alerts" },
];

type Item = { kind: "page" | "stock"; label: string; hint?: string; href: string };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ⌘K / Ctrl+K / "/" from anywhere. Jump to a page or open any NSE stock. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(q.trim(), 140);

  const stocks = useQuery({ queryKey: ["symbols", term], queryFn: () => api.symbols(term), enabled: open && term.length > 0, staleTime: 60_000 });

  const items: Item[] = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pages = PAGES.filter((p) => !t || p.label.toLowerCase().includes(t)).map((p) => ({ kind: "page" as const, ...p }));
    const found = (stocks.data?.results ?? []).map((s) => ({ kind: "stock" as const, label: s.symbol, hint: s.name, href: `/s/${encodeURIComponent(s.symbol)}` }));
    return t ? [...found, ...pages] : pages;
  }, [q, stocks.data]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);
  useEffect(() => setActive(0), [items.length]);

  if (!open) return null;

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === "Escape") onClose();
  };

  return (
    <div className="palette-scrim" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          placeholder="Search stocks or jump to a page"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <ul className="palette-list" id={listId} role="listbox">
          {items.map((it, i) => (
            <li
              key={it.href}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(it)}
            >
              <span className={it.kind === "stock" ? "sym" : ""}>{it.label}</span>
              {it.hint && <span className="sub">{it.hint}</span>}
              <span className="palette-kind">{it.kind === "stock" ? "Stock" : "Page"}</span>
            </li>
          ))}
          {term && !stocks.isFetching && items.length === 0 && <li className="palette-empty">No matches</li>}
        </ul>
        <div className="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close</div>
      </div>
    </div>
  );
}
