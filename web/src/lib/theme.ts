import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "pvs-theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(KEY) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

// Module-level store so every useTheme() subscriber stays in sync.
let currentTheme: Theme = typeof window !== "undefined" ? initialTheme() : "light";
const listeners = new Set<(t: Theme) => void>();

if (typeof window !== "undefined") {
  applyTheme(currentTheme);
}

function setGlobalTheme(t: Theme) {
  if (t === currentTheme) return;
  currentTheme = t;
  applyTheme(t);
  try {
    window.localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(t));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const listener = (t: Theme) => setTheme(t);
    listeners.add(listener);
    // sync on mount in case a previous instance updated first
    if (theme !== currentTheme) setTheme(currentTheme);
    return () => {
      listeners.delete(listener);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    theme,
    toggle: () => setGlobalTheme(currentTheme === "dark" ? "light" : "dark"),
    setTheme: (t: Theme) => setGlobalTheme(t),
  };
}
