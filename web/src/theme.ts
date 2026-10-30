// Three printings of the poster: Paper (light), Night (dark blue) and Pit Wall (the F1 broadcast look).
// The visitor's choice is remembered; without one, the system setting picks Paper or Night.
export type Theme = "light" | "dark" | "pitwall";

const KEY = "blindlap.theme.v1";
const ORDER: Theme[] = ["light", "dark", "pitwall"];
export const THEME_NAME: Record<Theme, string> = { light: "Paper", dark: "Night", pitwall: "Pit Wall" };
// The browser's own bar takes the page colour.
const BAR: Record<Theme, string> = { light: "#f3efe6", dark: "#0e1a2b", pitwall: "#15151e" };
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(t: Theme) => void>();

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return ORDER.includes(v as Theme) ? (v as Theme) : null;
  } catch {
    return null;
  }
}

export function theme(): Theme {
  return stored() ?? (media.matches ? "dark" : "light");
}

/** Night and Pit Wall are both printed light on dark. */
export function isDark(): boolean {
  return theme() !== "light";
}

/** The theme after this one, for the theme button. */
export function nextTheme(): Theme {
  return ORDER[(ORDER.indexOf(theme()) + 1) % ORDER.length];
}

/** A colour token of the current theme (for canvases and 3D, which cannot read CSS). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function apply() {
  const t = theme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[t]);
  listeners.forEach((fn) => fn(t));
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Private windows may refuse storage; the choice still applies to this visit.
  }
  apply();
}

export function onTheme(fn: (t: Theme) => void) {
  listeners.add(fn);
}

media.addEventListener("change", () => {
  if (!stored()) apply();
});
apply();
