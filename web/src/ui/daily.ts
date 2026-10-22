// The Daily Five: the same five laps for everyone on a given day, and a result grid to share.
import type { Index } from "../data";

export interface DailyLap {
  key: number;
  lapIndex: number;
}

export interface DailyResult {
  you: number; // 3 right, 1 teammate, 0 wrong
  model: number;
  truth: string;
  circuit: string;
}

export const DAILY_LAPS = 5;

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Small seeded generator so every visitor gets the same laps for the same date. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function dailyPlan(index: Index, date: string): DailyLap[] {
  const rand = mulberry32(hash(`blindlap:${date}`));
  const keys = [...index.sessions].sort((a, b) => a.key - b.key);
  const plan: DailyLap[] = [];
  const used = new Set<number>();
  while (plan.length < Math.min(DAILY_LAPS, keys.length)) {
    const s = keys[Math.floor(rand() * keys.length)];
    if (used.has(s.key)) continue;
    used.add(s.key);
    plan.push({ key: s.key, lapIndex: Math.floor(rand() * s.laps) });
  }
  return plan;
}

const storeKey = (date: string) => `blindlap.daily.${date}`;

export function readDaily(date: string): DailyResult[] {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(date)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function writeDaily(date: string, results: DailyResult[]) {
  try {
    localStorage.setItem(storeKey(date), JSON.stringify(results));
  } catch {
    /* storage blocked: the day lives in this tab only */
  }
}

const square = (pts: number) => (pts === 3 ? "🟩" : pts === 1 ? "🟨" : "⬛");

export function shareText(date: string, results: DailyResult[]): string {
  const you = results.reduce((a, r) => a + r.you, 0);
  const model = results.reduce((a, r) => a + r.model, 0);
  const d = new Date(`${date}T12:00:00`);
  const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return [
    `BLIND LAP · daily five · ${label}`,
    `You   ${results.map((r) => square(r.you)).join("")} ${you}`,
    `Model ${results.map((r) => square(r.model)).join("")} ${model}`,
    location.href.split("#")[0],
  ].join("\n");
}

/** Summary card markup: one row per lap, you against the model. */
export function summaryHtml(date: string, results: DailyResult[]): string {
  const you = results.reduce((a, r) => a + r.you, 0);
  const model = results.reduce((a, r) => a + r.model, 0);
  const cell = (pts: number) => `<i class="sq ${pts === 3 ? "win" : pts === 1 ? "half" : "miss"}" aria-label="${pts === 3 ? "right" : pts === 1 ? "teammate" : "wrong"}"></i>`;
  const verdict = you > model ? "You beat the model today." : you === model ? "Dead heat with the model." : "The model wins today.";
  return `
    <h2 class="display">Daily<br>five</h2>
    <p class="caps team num">${date} · ${verdict}</p>
    <table class="daily-grid">
      <thead><tr><th scope="col">Lap</th><th scope="col">Driver</th><th scope="col">You</th><th scope="col">Model</th></tr></thead>
      <tbody>${results
        .map((r, i) => `<tr><td class="num">${i + 1} · ${r.circuit}</td><td><b>${r.truth}</b></td><td>${cell(r.you)}</td><td>${cell(r.model)}</td></tr>`)
        .join("")}</tbody>
      <tfoot><tr><td colspan="2">Points (3 right, 1 teammate)</td><td class="num">${you}</td><td class="num">${model}</td></tr></tfoot>
    </table>`;
}
