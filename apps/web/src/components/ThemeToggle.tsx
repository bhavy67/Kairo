"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun, IconSystem } from "./Icons";

type Theme = "system" | "light" | "dark";
const KEY = "kairo-theme";
const OPTIONS: { value: Theme; label: string; Icon: () => React.ReactElement }[] = [
  { value: "system", label: "Match system", Icon: IconSystem },
  { value: "light", label: "Light", Icon: IconSun },
  { value: "dark", label: "Dark", Icon: IconMoon },
];

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      /* storage blocked: stay on system */
    }
  }, []);

  const choose = (t: Theme) => {
    setTheme(t);
    apply(t);
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="theme" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" aria-label={label} title={label} aria-pressed={theme === value} onClick={() => choose(value)}>
          <Icon />
        </button>
      ))}
    </div>
  );
}
