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

export interface Index {
  seasons: number[];
  session: string;
  tau: number;
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
}

export interface FoldModel {
  W: number[][];
  b: number[];
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
