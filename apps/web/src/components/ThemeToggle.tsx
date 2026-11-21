"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./Icons";

type Mode = "light" | "dark";
const KEY = "kairo-theme";
/** Page background per theme: also the phone's status-bar colour. Keep in sync with globals.css. */
const BAR: Record<Mode, string> = { light: "#f6f6f4", dark: "#0f0f0e" };

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const device = (): Mode => (media().matches ? "dark" : "light");
const override = (): Mode | null => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : null;
};
const current = (): Mode => override() ?? device();

/** The browser's status-bar tint follows the device unless the page overrides it. */
function syncBar(o: Mode | null) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const forDark = (m.getAttribute("media") ?? "").includes("dark");
    m.content = BAR[o ?? (forDark ? "dark" : "light")];
  });
}

/**
 * One button: follows the device by default, and flips between light and dark
 * when pressed. A flip that lands on what the device already uses drops the
 * override, so the app goes back to following the device (and its schedule,
 * such as dark mode at sunset) with no separate "system" option.
 */
export function ThemeToggle() {
  // Null until mounted: the server cannot know the theme. Icons swap in CSS meanwhile.
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    setMode(current());
    syncBar(override());
    const onChange = () => setMode(current());
    const mq = media();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const flip = () => {
    const next: Mode = current() === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const follow = next === device();
    // A short crossfade for the page itself; skipped when motion is reduced (see CSS).
    root.classList.add("theme-switching");
    if (follow) delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      if (follow) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: the change still applies to this visit */
    }
    syncBar(follow ? null : next);
    setMode(next);
    window.setTimeout(() => root.classList.remove("theme-switching"), 320);
  };

  const label = mode === null ? "Switch theme" : mode === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button type="button" className="theme-btn" onClick={flip} aria-label={label} title={label}>
      <span className="ic-moon"><IconMoon /></span>
      <span className="ic-sun"><IconSun /></span>
    </button>
  );
}
