// Shapes of the JSON written by pipeline/export.py, and cached loaders for them.

export interface SessionSummary {
  key: number;
  circuit: string;
  country: string;
  location: string;
  date: string;
  meeting: string | null;
  length: number;
  corners: number;
  laps: number;
  year: number;
}

export interface ModelInfo {
  id: string; // "gbm" | "forest" | "logreg"
  name: string;
  tau: number;
  top1: number;
}

export interface Index {
  seasons: number[];
  session: string;
  models: ModelInfo[]; // best first
  features: string[];
  cornerClasses: string[];
  classes: string[];
  sessions: SessionSummary[];
}

export interface CornerZone {
  n: number | string; // "12A" where a corner is split
  s: number;
  lo: number;
  hi: number;
  cls: number;
  braked: boolean;
}

export interface DriverInfo {
  code: string;
  name: string;
  team: string;
  colour: string;
}

export interface LapData {
  id: string;
  driver: number;
  code: string;
  lapNumber: number;
  lapTime: number;
  t: number[];
  s: number[];
  v: number[];
  thr: number[];
  brk: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
  z: number[][];
  raw: (number | null)[][];
  radio: string | null;
  steps: Record<string, number[][]>; // per model: log P(driver | corner) in tenths, corners x model classes
}

export interface FoldModel {
  classes: string[];
}

export interface Session {
  key: number;
  circuit: string;
  country: string;
  location: string;
  date: string;
  meeting: string | null;
  rotation: number;
  length: number;
  track: { step: number; x: number[]; y: number[]; z: number[] };
  corners: CornerZone[];
  field: { med: (number | null)[][]; scale: number[][] };
  drivers: Record<string, DriverInfo>;
  model: FoldModel;
  laps: LapData[];
}

export interface CrossSeason {
  train: number;
  test: number;
  laps: number;
  drivers: number;
  top1: number;
  top3: number;
  team: number;
  chance: number;
}

export interface ModelReport {
    name: string;
    teammate?: number | null;
    teammateLaps?: number;
    top1: number;
    top3: number;
    team: number;
    tau: number;
    nll: number;
    laps: number;
    chance: number;
    classes: string[];
    sessions: { circuit: string; top1: number; laps: number }[];
    confusion: number[][];
}

export interface Report {
  logreg: ModelReport;
  forest: ModelReport;
  gbm: ModelReport;
  crossSeason?: CrossSeason;
}

export interface DnaDriver {
  code: string;
  name: string;
  team: string;
  colour: string;
  pos: [number, number, number];
  vector: number[];
  neighbours: string[];
  style: Record<string, number>;
  styleRaw?: Record<string, number>;
  tells?: string[];
}

export interface Dna {
  explained: number[];
  loadings: { feature: string; pc: number[] }[];
  drivers: DnaDriver[];
}

export interface Career {
  id: string;
  born: string;
  nationality: string;
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  titles: number;
}

export interface Careers {
  source: string;
  drivers: Record<string, Career>;
}

const base = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(base + path).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
        return r.json();
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}

export const loadIndex = () => get<Index>("index.json");
export const loadSession = (key: number) => get<Session>(`sessions/${key}.json`);
export const loadReport = () => get<Report>("report.json");
export const loadDna = () => get<Dna>("dna.json");
/** Where speech starts in each team radio clip (they often open with seconds of silence). */
export interface RadioClip {
  start: number;
  duration: number;
  lines?: { t0: number; t1: number; text: string }[];
}
export const loadRadio = () => get<Record<string, RadioClip>>("radio.json").catch(() => ({}) as Record<string, RadioClip>);
/** Qualifying context per session (pipeline/results.py): each game lap's segment, and every
 * driver's final position and best Q1/Q2/Q3 times, keyed by driver number. */
export interface SessionResult {
  segments: Record<string, "Q1" | "Q2" | "Q3">;
  drivers: Record<string, { pos: number | null; best: (number | null)[] | null; status: string | null }>;
}
export const loadResults = () =>
  get<Record<string, SessionResult>>("results.json").catch(() => ({}) as Record<string, SessionResult>);
// Optional second dataset: an empty set keeps the game working if the file is missing.
export const loadCareers = () => get<Careers>("careers.json").catch((): Careers => ({ source: "", drivers: {} }));

/** "73 wins · 50 poles · 4 titles", dropping zero counts after the first. */
export function careerLine(c: Career | undefined): string {
  if (!c) return "";
  const parts = [`${c.starts} starts`];
  if (c.wins) parts.push(`${c.wins} win${c.wins === 1 ? "" : "s"}`);
  if (c.poles) parts.push(`${c.poles} pole${c.poles === 1 ? "" : "s"}`);
  if (c.titles) parts.push(`${c.titles} title${c.titles === 1 ? "" : "s"}`);
  if (!c.wins && c.podiums) parts.push(`${c.podiums} podium${c.podiums === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
