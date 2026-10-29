// Shapes of the JSON written by pipeline/export.py, and cached loaders for them.
import type { EnvData, EnvSession } from "./scene/environment";

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
  id: string; // "blend" | "gbm" | "logreg"
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
  blend: ModelReport;
  logreg: ModelReport;
  forest: ModelReport;
  gbm: ModelReport;
  crossSeason?: CrossSeason;
}

/** Driver DNA (pipeline/dna.py). "Own" values have the car taken out; "Raw" ones are as driven. */
export interface DnaDriver {
  code: string;
  name: string;
  team: string;
  colour: string;
  pos: [number, number, number];
  posRaw: [number, number, number];
  vector: number[];
  neighbours: string[];
  neighboursRaw: string[];
  style: Record<string, number>;
  styleRaw: Record<string, number>;
  tells: string[];
  corners: number;
  seasons: Record<string, { team: string; corners: number; traits: Record<string, number> }>;
}

export interface DnaCar {
  team: string;
  year: number;
  colour: string;
  traits: Record<string, number>;
  drivers: string[];
}

export interface Dna {
  explained: number[];
  explainedRaw: number[];
  teammateNearest: { asDriven: number; ownStyle: number; drivers: number };
  carShare: Record<string, number>;
  drivers: DnaDriver[];
  cars: DnaCar[];
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

// Files the page's HTML already started fetching (index.html), handed over to this cache.
const early: Partial<Record<string, Promise<unknown>>> = (window as Window & { __data?: Record<string, Promise<unknown>> }).__data ?? {};

function get<T>(path: string): Promise<T> {
  const handed = early[path];
  if (!cache.has(path) && handed) cache.set(path, handed);
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
/** The home broadcast's copy of a session: the track and its fastest lap only (pipeline/home.py),
 * about 15 KB instead of 240. */
export const loadHomeSession = (key: number) => get<Session>(`home/${key}.json`);
export const loadReport = () => get<Report>("report.json");
export const loadDna = () => get<Dna>("dna.json");
/** Where speech starts in each team radio clip (they often open with seconds of silence). */
export interface RadioClip {
  start: number;
  duration: number;
  lines?: { t0: number; t1: number; text: string }[];
}
export const loadRadio = () => get<Record<string, RadioClip>>("radio.json").catch(() => ({}) as Record<string, RadioClip>);
/** One exact lap: a session and the lap's position in it (-1: any lap of that session). */
export interface LapRef {
  key: number;
  lapIndex: number;
}

/** Qualifying context per session (pipeline/results.py): each game lap's segment, and every
 * driver's final position and best Q1/Q2/Q3 times, keyed by driver number. */
export interface SessionResult {
  segments: Record<string, "Q1" | "Q2" | "Q3">;
  drivers: Record<string, { pos: number | null; best: (number | null)[] | null; status: string | null }>;
}
export const loadResults = () =>
  get<Record<string, SessionResult>>("results.json").catch(() => ({}) as Record<string, SessionResult>);
// Optional second dataset: an empty set keeps the game working if the file is missing.
// Real surroundings (pipeline/environment.py). Optional: without them the circuit keeps its plain ground.
export const loadEnvIndex = () =>
  get<Record<string, EnvSession>>("env/index.json").catch(() => ({}) as Record<string, EnvSession>);
export const loadEnv = (name: string) => get<EnvData>(`env/${name}.json`);
/** Fetch a session's surroundings ahead of time, so they appear with the track, not after it. */
export const prefetchSurroundings = (key: number) =>
  loadEnvIndex()
    .then((index) => (index[String(key)] ? loadEnv(index[String(key)].env) : null))
    .catch(() => null);
/** Teammate qualifying head-to-heads per season (pipeline/battles.py). gap: first driver minus second,
 * in seconds, in the furthest segment both set a time in. */
export interface BattlePair {
  drivers: { code: string; name: string }[];
  score: [number, number];
  medianGap: number | null;
  rounds: { key: number; circuit: string; date: string; pos: (number | null)[]; seg: string | null; gap: number | null; winner: string }[];
}
export interface Battles {
  seasons: Record<string, { team: string; colour: string; pairs: BattlePair[] }[]>;
}
export const loadBattles = () => get<Battles>("battles.json");
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
