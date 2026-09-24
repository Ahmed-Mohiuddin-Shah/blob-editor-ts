import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export type ThemeMode = "light" | "dark" | "system";

export interface EditorTheme {
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  /** true = sharp / square chrome; false = Blobby soft radii (default). */
  blocky: boolean;
  /** light | dark | system (follow OS). Default: system. */
  themeMode: ThemeMode;
}

export const DEFAULT_THEME: EditorTheme = {
  primary: "#f10ea0",
  onPrimary: "#ffffff",
  secondary: "#e95214",
  onSecondary: "#ffffff",
  blocky: false,
  themeMode: "system",
};

export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/** Subscribe to OS color-scheme for `themeMode: "system"`. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    setDark(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

const LIGHT = {
  fg: "#000000",
  muted: "#666666",
  glass: "rgba(255, 255, 255, 0.55)",
  glassSolid: "rgba(255, 255, 255, 0.72)",
  glassBorder: "rgba(0, 0, 0, 0.08)",
  btn: "rgba(0, 0, 0, 0.06)",
  btnBorder: "rgba(0, 0, 0, 0.12)",
  inputBorder: "rgba(0, 0, 0, 0.15)",
  stageTint: "rgba(0, 0, 0, 0.03)",
  checkerA: "#ddd",
  checkerB: "#fff",
};

const DARK = {
  fg: "#ffffff",
  muted: "rgba(255, 255, 255, 0.62)",
  glass: "rgba(26, 26, 26, 0.55)",
  glassSolid: "rgba(26, 26, 26, 0.72)",
  glassBorder: "rgba(255, 255, 255, 0.12)",
  btn: "rgba(255, 255, 255, 0.1)",
  btnBorder: "rgba(255, 255, 255, 0.18)",
  inputBorder: "rgba(255, 255, 255, 0.2)",
  stageTint: "rgba(255, 255, 255, 0.04)",
  checkerA: "#333",
  checkerB: "#1a1a1a",
};

export function themeStyle(t: EditorTheme, resolved: "light" | "dark"): CSSProperties {
  const radius = t.blocky ? "0px" : "9999px";
  const panel = t.blocky ? "0px" : "1.5rem";
  const c = resolved === "dark" ? DARK : LIGHT;
  return {
    ["--blob-primary" as string]: t.primary,
    ["--blob-on-primary" as string]: t.onPrimary,
    ["--blob-secondary" as string]: t.secondary,
    ["--blob-on-secondary" as string]: t.onSecondary,
    ["--blob-radius" as string]: radius,
    ["--blob-panel-radius" as string]: panel,
    ["--blob-fg" as string]: c.fg,
    ["--blob-muted" as string]: c.muted,
    ["--blob-glass" as string]: c.glass,
    ["--blob-glass-solid" as string]: c.glassSolid,
    ["--blob-glass-border" as string]: c.glassBorder,
    ["--blob-btn" as string]: c.btn,
    ["--blob-btn-border" as string]: c.btnBorder,
    ["--blob-input-border" as string]: c.inputBorder,
    ["--blob-stage-tint" as string]: c.stageTint,
    ["--blob-checker-a" as string]: c.checkerA,
    ["--blob-checker-b" as string]: c.checkerB,
    colorScheme: resolved,
  };
}
