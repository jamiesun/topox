import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "topox.theme";

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (systemDark() ? "dark" : "light") : mode;
}

function readStored(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/**
 * Theme state: light / dark / follow-system, persisted to localStorage and
 * applied as a `data-theme` attribute on <html> so CSS variables switch.
 */
export function useTheme(): {
  mode: ThemeMode;
  resolved: "light" | "dark";
  cycle: () => void;
} {
  const [mode, setMode] = useState<ThemeMode>(readStored);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(readStored()));

  useEffect(() => {
    const apply = () => setResolved(resolve(mode));
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const cycle = useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode = prev === "system" ? "light" : prev === "light" ? "dark" : "system";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { mode, resolved, cycle };
}
