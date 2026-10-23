// Light or dark. The visitor's choice is remembered; without one, the system setting decides.
export type Theme = "light" | "dark";

const KEY = "blindlap.theme.v1";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(t: Theme) => void>();

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function theme(): Theme {
  return stored() ?? (media.matches ? "dark" : "light");
}

export function isDark(): boolean {
  return theme() === "dark";
}

function apply() {
  const t = theme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#121212" : "#f1f0ec");
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
