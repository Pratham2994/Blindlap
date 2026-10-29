// The 3D circuit: a raised asphalt strip built from the real position data, sitting on a ground
// moulded like a tyre sidewall, with the car laying a rubber line that remembers the evidence.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/** Speed blur: samples pulled toward the middle of the view, stronger toward the edges and the
 * faster the car goes, as a fast camera smears the scenery passing it. */
const SpeedBlurShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.001) { gl_FragColor = c; return; }
      vec2 d = vUv - 0.5;
      float edge = smoothstep(0.16, 0.7, length(d * vec2(1.4, 1.0)));
      vec2 stepv = -d * 0.045 * uStrength * edge;
      vec4 acc = c;
      for (int k = 1; k <= 6; k++) acc += texture2D(tDiffuse, vUv + stepv * float(k));
      gl_FragColor = acc / 7.0;
    }`,
};

/** A light camera grade after tone mapping: a little contrast and saturation, and a soft
 * vignette, like broadcast footage. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.32 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.12);                 // saturation
      col = (col - 0.5) * 1.06 + 0.5;                // contrast
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0)));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};
import type { LapData, Session } from "../data";
import { contactShadow, fitF1Model, loadF1Model, makeF1Car } from "./car";
import { asphaltTexture, boardTexture, GROUND_PX, labelTexture, posterGround } from "./textures";
import type { GroundAreas } from "./textures";
import { loadEnv, loadEnvIndex } from "../data";
import type { EnvData, EnvSession } from "./environment";
import { buildingsMesh, facadeTextures, mapToTrack, standsGroup, Terrain, treesGroup, wheelMesh } from "./environment";
import { boards, inside, marshalPosts, Occupancy, rectangle, TrackClearance } from "./trackside";

// The poster palette in the scene: ink, paper, F1 red.
export const INK = new THREE.Color("#141414");
const PAPER = new THREE.Color("#f3f2ee");
const RED = new THREE.Color("#e10600");

// Haze colour in linear space, equal to the sky shader's horizon so ground and sky meet without a seam.
// The sun's direction: low and to one side, so the relief of the scene reads.
const SUN_DIR = new THREE.Vector3(0.9, 0.55, 0.35).normalize();
const HAZE = new THREE.Color().setRGB(0.62, 0.61, 0.58, THREE.LinearSRGBColorSpace);
// A night race: deep navy overhead and the city's warm glow along the horizon (a flat black sky
// read as a void), with a few stars. Sky and fog meet at the horizon colour.
const NIGHT = {
  background: new THREE.Color("#141413"),
  haze: new THREE.Color().setRGB(0.032, 0.026, 0.03, THREE.LinearSRGBColorSpace),
  zenith: new THREE.Vector3(0.004, 0.006, 0.016),
  horizon: new THREE.Vector3(0.032, 0.026, 0.03),
};
// The dark theme at a daytime race: late evening, a deep blue sky that still reads as sky, so the
// sunlit trees and stands never sit under a black void.
const EVENING = {
  background: new THREE.Color("#1b2230"),
  haze: new THREE.Color().setRGB(0.035, 0.045, 0.07, THREE.LinearSRGBColorSpace),
  zenith: new THREE.Vector3(0.012, 0.022, 0.06),
  horizon: new THREE.Vector3(0.085, 0.1, 0.15),
};
// A race at sunset (Yas Marina): low warm light, a deep sky with an orange horizon.
const DUSK = {
  background: new THREE.Color("#2a2328"),
  haze: new THREE.Color().setRGB(0.09, 0.06, 0.05, THREE.LinearSRGBColorSpace),
  zenith: new THREE.Vector3(0.03, 0.035, 0.07),
  horizon: new THREE.Vector3(0.42, 0.2, 0.09),
};
// A clear day: deep blue overhead, pale at the horizon, and fog in the horizon colour so distance
// fades into blue air. (A flat grey sky and fog made the scene look like a model under a cloth.)
// Quality levels, best first. The game starts at 0 (or 1 on small devices) and steps down by
// itself while frames are slow.
// "minimal" is for the weakest machines: no shadows and no full-screen effect passes at all (the
// scene goes straight to the screen), and no spectators.
const QUALITY = [
  { name: "full", pixels: 2, shadow: 4096, bloom: true, crowds: true, post: true, shadows: true },
  { name: "balanced", pixels: 1.25, shadow: 2048, bloom: true, crowds: true, post: true, shadows: true },
  { name: "light", pixels: 1, shadow: 1024, bloom: false, crowds: true, post: true, shadows: true },
  { name: "minimal", pixels: 0.75, shadow: 1024, bloom: false, crowds: false, post: false, shadows: false },
];

/** Where to start, before any frame is timed: lower on small devices, on integrated or phone
 * graphics, and lowest on a software renderer (no graphics card in use at all). */
function startQuality(renderer: THREE.WebGLRenderer): number {
  // The screenshot scripts (web/scripts) force a level, since their software renderer would start
  // at the lowest.
  try {
    const forced = localStorage.getItem("blindlap.quality.v1");
    if (forced !== null && QUALITY[Number(forced)]) return Number(forced);
  } catch {
    // Storage refused: guess as usual.
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  let q = (navigator.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 ? 1 : 0;
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) q = 3;
    else if (/mali|adreno|powervr|apple gpu|intel/i.test(name)) q = Math.max(q, /intel.*(arc|iris xe)/i.test(name) ? 1 : 2);
  } catch {
    // No renderer name: keep the guess from the device.
  }
  // Phones: a small touch screen.
  if (matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600) q = Math.max(q, 2);
  return q;
}

// Indices of features in a lap's raw corner values and z-scores (pipeline/features.py FEATURES).
const BRAKE_POINT = 0;
const APEX_SPEED = 3;
const APEX_OFFSET = 4;
const THROTTLE_POINT = 5;

/** How one lap drove each corner, against the field, turned into the shape of its line. The data
 * has no real sideways position (OpenF1 snaps every car to one line), so the line is the circuit's
 * minimum-curvature line reshaped by what this lap really did:
 * - entry: a later braking point turns in later;
 * - apex: the real slowest point moves the apex earlier or later;
 * - exit: an earlier full throttle straightens the car up sooner;
 * - width: more apex speed than the field is a fuller arc that uses more road, onto the inside
 *   kerb where there is one; less is a tighter, tidier line. */
interface CornerShape {
  s: number; // the corner marker, metres along the lap
  entry: number; // metres the turn-in moves later (+) or earlier (-)
  apex: number;
  exit: number;
  width: number; // fraction the line's swing grows (+) or shrinks (-) around the apex
  turn: number; // +1 when the corner turns toward +side: the inside, where the kerb is
}
type LineShape = CornerShape[];

/** A lap's line, worked out once per lap at every point of the track frame: the sideways offset
 * from the centre line, and how far up a kerb the car is there (0 to 1). */
interface LapLine {
  offset: Float64Array;
  lift: Float64Array;
}

function lineShape(lap: LapData, session: Session, turnSign: (s: number) => number): LineShape {
  const out: LineShape = [];
  const clamp = THREE.MathUtils.clamp;
  session.corners.forEach((c, k) => {
    const raw = lap.raw?.[k];
    const med = session.field.med[k];
    const z = lap.z?.[k];
    if (!raw || !med) return;
    const d = (f: number) => {
      const a = raw[f];
      const b = med[f];
      return a != null && b != null ? a - b : 0;
    };
    out.push({
      s: c.s,
      entry: c.braked ? clamp(d(BRAKE_POINT) * 0.5, -10, 10) : 0,
      apex: clamp(d(APEX_OFFSET), -16, 16),
      exit: clamp(d(THROTTLE_POINT) * 0.4, -10, 10),
      width: clamp(0.08 * (z?.[APEX_SPEED] ?? 0) - 0.03 * (z?.[THROTTLE_POINT] ?? 0), -0.25, 0.28),
      turn: turnSign(c.s),
    });
  });
  return out;
}

// Spreads of the reshaping around a corner (metres): entry and exit 50 m either side of the apex.
const SHAPE_ENTRY = 50;
const SHAPE_SPREAD = 28;
const SHAPE_APEX = 40;
// The inside kerb runs 28 m either side of the corner marker (buildKerbs). Only a fuller line than
// the field's goes onto it, further the more apex speed the lap carried: up to KERB_REACH metres
// past the usual limit (inside wheels on the white line), which keeps them on the 1.6 m kerb.
const KERB_SPAN = 25;
const KERB_REACH = 1.55;
const KERB_PER_WIDTH = 9; // metres onto the kerb per unit of extra width
const KERB_HEIGHT = 0.09;

// How much the light ground texture is dimmed in the dark theme and at night.
const GROUND_DIM = 0.2;
const DAY = {
  background: new THREE.Color("#a9c8e4"),
  haze: new THREE.Color().setRGB(0.52, 0.64, 0.78, THREE.LinearSRGBColorSpace),
  zenith: new THREE.Vector3(0.1, 0.26, 0.58),
  horizon: new THREE.Vector3(0.56, 0.68, 0.82),
};

/** Close-up texture for the ground, worked out in the shader from the world position, so it costs
 * no texture memory and never tiles: soft patches of lighter and darker growth, fine grain, and
 * (on grass verges) the broad mowing stripes every circuit has. Without it the ground was one flat
 * colour from close up. */
function groundDetail(mat: THREE.MeshStandardMaterial, stripes: boolean) {
  // 1 shows the stripes; a street verge (pavement) turns them off.
  const uStripes = { value: stripes ? 1 : 0 };
  mat.userData.stripes = uStripes;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStripes = uStripes;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGroundXZ;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec2 vGroundXZ;
        uniform float uStripes;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec2 q = vGroundXZ;
          float patches = gNoise(q * 0.045) * 0.6 + gNoise(q * 0.17) * 0.4;
          float grain = gNoise(q * 1.9) - 0.5;
          float k = 0.9 + 0.16 * patches + 0.07 * grain;
          float band = smoothstep(0.42, 0.5, abs(fract(dot(q, vec2(0.6, 0.8)) / 22.0) - 0.5) * 2.0 - 0.02);
          k *= mix(1.0, mix(0.89, 1.07, band), uStripes);
          diffuseColor.rgb *= k;
        }`,
      );
  };
  mat.customProgramCacheKey = () => "ground-detail";
  return mat;
}

const REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const BARRIER_LIGHT = "#f3f2ee";
const BARRIER_DARK = "#e10600";

const ELEVATION = 1.25; // slight vertical exaggeration so hills read; at 2x slopes looked like ramps
const TRACK_WIDTH = 13;
const STRIP_DEPTH = 3; // the track is a thick strip floating over the sidewall, casting its shadow
const FLOAT = 10;
const CLEARANCE = 13; // where the track crosses itself (Suzuka), the upper road clears the lower by this much
const RAMP = 260; // metres either side of a crossing over which the upper road is lifted

/** For each point, each side (index 0 = +side, 1 = -side): the road's half-width, where the barrier
 * goes, whether this point draws that barrier, and whether there is room for kerbs and a fence. */
interface TrackEdges {
  half: [Float64Array, Float64Array];
  wall: [Float64Array, Float64Array];
  drawWall: [Uint8Array, Uint8Array];
  open: [Uint8Array, Uint8Array]; // 1 = nothing alongside: kerbs, fence and boards fit
}

/** Where another part of the circuit runs alongside (Baku: centre lines 9 m apart for 250 m), a
 * 13 m road with barriers 3 m beyond it lands on the other road. On that side the road narrows to
 * share the space, one wall stands in the middle (drawn by one of the two sections only), and the
 * kerbs, fence and boards are left out. Sections far apart in height (Suzuka's bridge) are not
 * alongside each other. */
function trackEdges(pos: THREE.Vector3[], tan: THREE.Vector3[], side: THREE.Vector3[], step: number): TrackEdges {
  const n = pos.length;
  const apart = Math.ceil(300 / step);
  const full = TRACK_WIDTH / 2;
  const gap = [new Float64Array(n).fill(Infinity), new Float64Array(n).fill(Infinity)];
  const mine = [new Uint8Array(n), new Uint8Array(n)];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const sep = Math.abs(i - j);
      if (Math.min(sep, n - sep) < apart) continue;
      const dx = pos[j].x - pos[i].x;
      const dz = pos[j].z - pos[i].z;
      if (dx * dx + dz * dz > 900 || Math.abs(pos[j].y - pos[i].y) > 6) continue;
      if (Math.abs(dx * tan[i].x + dz * tan[i].z) > 10) continue; // ahead or behind, not beside
      const lat = dx * side[i].x + dz * side[i].z;
      const k = lat > 0 ? 0 : 1;
      if (Math.abs(lat) < gap[k][i]) {
        gap[k][i] = Math.abs(lat);
        mine[k][i] = j > i ? 1 : 0;
      }
    }
  }
  const out: TrackEdges = {
    half: [new Float64Array(n), new Float64Array(n)],
    wall: [new Float64Array(n), new Float64Array(n)],
    drawWall: [new Uint8Array(n), new Uint8Array(n)],
    open: [new Uint8Array(n), new Uint8Array(n)],
  };
  const reach = Math.ceil(24 / step); // start narrowing this far before the sections meet
  for (const k of [0, 1] as const) {
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      let own = 1;
      for (let d = -reach; d <= reach; d++) {
        const q = (i + d + n) % n;
        if (gap[k][q] < m) {
          m = gap[k][q];
          own = mine[k][q];
        }
      }
      const shared = m < 2 * (full + 5);
      out.open[k][i] = shared ? 0 : 1;
      out.wall[k][i] = shared ? m / 2 : full + 3.2;
      out.drawWall[k][i] = shared ? own : 1;
      out.half[k][i] = Number.isFinite(m) ? THREE.MathUtils.clamp(m / 2 - 0.5, 3.6, full) : full;
    }
    // Ease the narrowing in and out so the road edge never steps.
    const h = Float64Array.from(out.half[k]);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let d = -reach; d <= reach; d++) sum += h[(i + d + n) % n];
      out.half[k][i] = Math.min(h[i], sum / (2 * reach + 1));
    }
  }
  return out;
}

/** A racing line, since the data has none per driver (positions are snapped to one line): the
 * line of least curvature that fits inside the track, the same idea as the minimum-curvature lines
 * race engineers compute. The gentler the bend, the higher the speed it allows, so the line swings
 * to the outside before a corner, cuts to the apex on the inside and runs out wide again.
 * (Minimising length instead, like a taut string, hugged the inside of every corner.)
 *
 * Each point moves to where the curve through its two neighbours on each side is smoothest
 * (the minimum of the squared second difference), updated in place and held inside the track
 * edges; coarse spans first so whole corners settle, then finer. Returns the sideways offset
 * from the centre line. */
function racingLine(pos: THREE.Vector3[], side: THREE.Vector3[], step: number, edges: TrackEdges, cornerAt: number[] = []): Float64Array {
  const n = pos.length;
  // How far the middle of the 2 m car may go toward each edge: on the straights about a metre
  // inside the white line; within 45 m of a corner right out to it, wheels on the line but never
  // over the kerb (the kerbs are drawn outside the road, and a car on them looked as if it drove
  // through them).
  const nearCorner = new Uint8Array(n);
  const reach = Math.round(45 / step);
  for (const s of cornerAt) {
    const c = Math.round(s / step);
    for (let d = -reach; d <= reach; d++) nearCorner[(((c + d) % n) + n) % n] = 1;
  }
  const margin = (i: number) => (nearCorner[i] ? 1.05 : 1.3);
  const lo = Float64Array.from(edges.half[1], (h, i) => -Math.max(0.3, h - margin(i)));
  const hi = Float64Array.from(edges.half[0], (h, i) => Math.max(0.3, h - margin(i)));
  const a = new Float64Array(n);
  const qx = (i: number) => pos[i].x + side[i].x * a[i];
  const qz = (i: number) => pos[i].z + side[i].z * a[i];
  for (const span of [64, 32, 16, 8, 4]) {
    const k = Math.max(1, Math.round(span / step));
    for (let it = 0; it < 250; it++) {
      for (let i = 0; i < n; i++) {
        const m1 = (i - k + n) % n;
        const p1 = (i + k) % n;
        const m2 = (i - 2 * k + 2 * n) % n;
        const p2 = (i + 2 * k) % n;
        // The point that makes the curvature here smallest, given its neighbours.
        const tx = (4 * (qx(m1) + qx(p1)) - qx(m2) - qx(p2)) / 6 - pos[i].x;
        const tz = (4 * (qz(m1) + qz(p1)) - qz(m2) - qz(p2)) / 6 - pos[i].z;
        a[i] = THREE.MathUtils.clamp(tx * side[i].x + tz * side[i].z, lo[i], hi[i]);
      }
    }
  }
  return a;
}

/** Find where the circuit passes over itself and lift the upper road on a smooth ramp. The recorded
 * heights put Suzuka's bridge only 1 to 2 m above the road under it, so the strips would touch. */
function raiseCrossings(pos: THREE.Vector3[], step: number) {
  const n = pos.length;
  const apart = Math.ceil(400 / step);
  const near = TRACK_WIDTH * 1.5;
  const lift = new Float64Array(n);
  let lastI = -Infinity;
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestD = near;
    for (let j = i + apart; j < n; j++) {
      if (n - (j - i) < apart) break;
      const d = Math.hypot(pos[i].x - pos[j].x, pos[i].z - pos[j].z);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    // One lift per crossing: take the first close pair and skip past the rest of that crossing.
    if (best < 0 || i - lastI < apart) continue;
    lastI = i;
    const [lo, hi] = pos[i].y <= pos[best].y ? [i, best] : [best, i];
    const need = CLEARANCE - (pos[hi].y - pos[lo].y);
    if (need <= 0) continue;
    const r = Math.ceil(RAMP / step);
    for (let k = -r; k <= r; k++) {
      const idx = (hi + k + n) % n;
      lift[idx] = Math.max(lift[idx], need * 0.5 * (1 + Math.cos((Math.PI * k) / r)));
    }
  }
  for (let i = 0; i < n; i++) pos[i].y += lift[i];
}

export type CameraMode = "chase" | "onboard" | "side" | "tv" | "heli" | "orbit";

interface TrackFrame {
  pos: THREE.Vector3[];
  tan: THREE.Vector3[];
  side: THREE.Vector3[];
  s: number[];
  length: number;
  line: Float64Array; // racing line: sideways offset from the centre line at each point
  edges: TrackEdges;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.5, 30000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private trackGroup = new THREE.Group();
  private frame: TrackFrame | null = null;
  private car: THREE.Group;
  private carWheels: THREE.Object3D[] = [];
  // How the shown lap (and the duel rival's lap) drove each corner: the shape of their lines.
  private lapLine: LapLine | null = null;
  private ghostLine: LapLine | null = null;
  private quality = 0;
  private speedBlur!: ShaderPass;
  private roll = 0; // camera lean into corners, radians
  private lastCarS = 0;
  private lastFrame = 0;
  private frameTimes: number[] = [];
  private ghostWheels: THREE.Object3D[] = [];
  private carColours: [THREE.ColorRepresentation, THREE.ColorRepresentation] = [INK, RED];
  private pulses: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; age: number }[] = [];
  private ghost: THREE.Group;
  private carLight: THREE.PointLight;
  // The sky and ground the car's paint reflects, made from the current palette (refreshReflections).
  private pmrem: THREE.PMREMGenerator | null = null;
  private reflections: THREE.WebGLRenderTarget | null = null;
  private sun: THREE.DirectionalLight;
  private line: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private labels: { sprite: THREE.Sprite; n: number | string; s: number; aspect: number; read: boolean; note?: string }[] = [];
  private dark = false;
  private hemi!: THREE.HemisphereLight;
  private sky!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private groundMat: THREE.MeshStandardMaterial | null = null;
  private groundText: [string, string] = ["", ""];
  private groundMesh: THREE.Mesh | null = null;
  private groundSize = 0;
  private groundAreas: GroundAreas | undefined;
  private groundKey = ""; // what the ground texture shows now, so it is only redrawn on change
  // Real surroundings: which session they are for, how track coordinates reach the scene, and
  // the track heights the terrain is blended from.
  private sessionKey = 0;
  private session: Session | null = null;
  private toScene: (x: number, y: number) => THREE.Vector2 = (x, y) => new THREE.Vector2(x, y);
  private terrainSamples: { x: number; z: number; y: number }[] = [];
  terrain: Terrain | null = null;
  // Public for scripts/track-check.mjs: the surroundings and the clearance rule they were built with.
  envGroup: THREE.Group | null = null;
  // The session whose surroundings are completely built (scripts/track-check.mjs waits for it).
  surroundingsFor = 0;
  clearance: TrackClearance | null = null; // public for scripts/ground-check.mjs: the ground must stay under every road
  private lightMode: "day" | "dusk" | "night" = "day";
  private floodlights: THREE.Group | null = null;
  private envMats = {
    // Colours come per vertex / per tree (the real or typical colour of each); the material is white.
    building: (() => {
      const f = facadeTextures();
      return new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.85, flatShading: true, map: f.wall, emissiveMap: f.lit });
    })(),
    stand: new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.8, flatShading: true }),
    crown: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true }),
    trunk: new THREE.MeshStandardMaterial({ color: "#6b5d4f", roughness: 0.95 }),
    wheel: new THREE.MeshStandardMaterial({ color: "#3a3936", roughness: 0.6, metalness: 0.2 }),
    crowd: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }),
  };
  private outerMat = groundDetail(new THREE.MeshStandardMaterial({ roughness: 1 }), false);
  private vergeMat = groundDetail(new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1 }), true);
  private vergeStreet = false;
  private outerStreet = false;
  private liveryHidden = true;
  private radius = 1000;
  private camPos = new THREE.Vector3(0, 800, 800);
  private camLook = new THREE.Vector3();
  private offset = new THREE.Vector3(0, 400, 400);
  private lookOffset = new THREE.Vector3();
  private orbitAngle = 0;
  private _mode: CameraMode = "orbit";
  // The visitor's own angle, set by dragging the stage: added to whichever camera is on.
  private userYaw = 0;
  private userPitch = 0;
  // 0 right after a camera switch, 1 once the new camera has settled.
  private blend = 1;
  // A new circuit: put the camera in place at once instead of flying it from where the car was
  // on the last circuit (which showed a second or two of bare ground, grey or black).
  private snap = true;
  // Which shadow the sun casts: near the car (sharp, for the close cameras) or the whole circuit.
  private shadowNear: boolean | null = null;

  get mode(): CameraMode {
    return this._mode;
  }

  /** Changing camera starts from that camera's own angle. */
  set mode(m: CameraMode) {
    if (m !== this._mode) {
      this.resetView();
      this.blend = 0;
    }
    this._mode = m;
  }

  /** Drag on the stage: x swings the camera round the car (or the circuit), y raises or lowers it. */
  nudgeView(dx: number, dy: number) {
    this.userYaw -= dx * 0.006;
    this.userPitch = THREE.MathUtils.clamp(this.userPitch + dy * 0.004, -0.8, 1.3);
  }

  resetView() {
    this.userYaw = 0;
    this.userPitch = 0;
  }
  labelsOn = true;
  private shift = 0;
  private dip = 0;
  private ghostS = 0;
  private fov = 52;
  carS = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.quality = startQuality(this.renderer);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[this.quality].pixels));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = QUALITY[this.quality].shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color("#dcdad4");
    this.scene.fog = new THREE.Fog(HAZE, 1500, 6000);
    this.sky = this.makeSky();
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight("#ffffff", "#8c8a84", 1.4);
    this.scene.add(this.hemi);
    // One low raking light, like late sun across a moulded sidewall: it makes the relief read.
    this.sun = new THREE.DirectionalLight("#fff4e6", 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(QUALITY[this.quality].shadow, QUALITY[this.quality].shadow);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    const built = makeF1Car(INK);
    const builtGhost = makeF1Car(RED);
    this.car = new THREE.Group().add(built.group, contactShadow());
    this.ghost = new THREE.Group().add(builtGhost.group, contactShadow());
    // Yaw, then pitch, then roll about the car's own length (kerbRoll).
    this.car.rotation.order = this.ghost.rotation.order = "YZX";
    this.carWheels = built.wheels;
    this.ghostWheels = builtGhost.wheels;
    // Swap in the modelled car when it arrives; keep the built one if it never does.
    loadF1Model()
      .then((source) => {
        const a = fitF1Model(source, new THREE.Color(INK));
        const b = fitF1Model(source, new THREE.Color(RED));
        this.car.remove(built.group);
        this.ghost.remove(builtGhost.group);
        this.car.add(a.group);
        this.ghost.add(b.group);
        this.carWheels = a.wheels;
        this.ghostWheels = b.wheels;
        if (this.liveryHidden) this.hideLivery();
        else this.setCarColours(...this.carColours);
        this.applyReflections();
      })
      .catch((e) => console.warn("Car model not loaded; keeping the built car.", e));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.carLight = new THREE.PointLight("#fff2dc", 7, 28, 1.8);
    this.car.add(this.carLight);
    // Ahead of the car, low, so it lights the asphalt it is about to cross, not its own roof.
    this.carLight.position.set(9, 2.5, 0);
    this.scene.add(this.trackGroup, this.car);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.45, 0.88);
    this.composer.addPass(this.bloom);
    this.speedBlur = new ShaderPass(SpeedBlurShader);
    this.composer.addPass(this.speedBlur);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
    this.resize();
    window.addEventListener("resize", () => this.resize());
    // The canvas moves between frames on different pages; follow whatever size its frame gives it.
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyShift(w, h);
    this.camera.updateProjectionMatrix();
  }

  /** Dark dome with a low warm haze at the horizon, where the raking light comes from. */
  private makeSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uZenith: { value: DAY.zenith.clone() }, uHorizon: { value: DAY.horizon.clone() }, uCloud: { value: 1 }, uCloudLit: { value: 1 }, uStars: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform float uCloud; // 1 by day, less at dusk, 0 at night
        uniform float uCloudLit; // how bright the clouds are: 1 by day, dim in the evening
        uniform float uStars; // 1 at a night race
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main() {
          float h = vDir.y;
          // Haze is a touch brighter on the side the light sits (+x), and thins quickly with height.
          float sun = max(dot(normalize(vDir.xz), normalize(vec2(0.9, 0.35))), 0.0);
          vec3 horizon = mix(uHorizon, uHorizon * 1.12, pow(sun, 8.0));
          float t = smoothstep(-0.02, 0.28, h);
          vec3 c = mix(horizon, uZenith, t);
          // Fair-weather clouds: noise on a flat sky plane, thinning toward the horizon.
          if (h > 0.01 && uCloud > 0.0) {
            vec2 q = vDir.xz / (h + 0.08) * 1.6;
            float d = smoothstep(0.52, 0.78, fbm(q + vec2(3.1, 7.7)));
            d *= smoothstep(0.01, 0.16, h) * uCloud;
            vec3 cloud = mix(vec3(0.97, 0.97, 0.98), uHorizon * 1.15, 0.25) * uCloudLit;
            c = mix(c, cloud, d * 0.85);
          }
          // Stars: a sparse grid of points on the sky, fading out toward the glow of the horizon.
          if (uStars > 0.0 && h > 0.08) {
            vec2 g = vec2(atan(vDir.z, vDir.x) * 180.0, h * 260.0);
            vec2 cell = floor(g);
            float r = hash(cell);
            if (r > 0.985) {
              vec2 at = cell + 0.5 + (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
              float d = length(g - at);
              c += vec3(0.6, 0.62, 0.7) * smoothstep(0.35, 0.0, d) * (r - 0.985) * 40.0 * smoothstep(0.08, 0.35, h) * uStars;
            }
          }
          if (h < -0.02) c = uHorizon;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    sky.scale.setScalar(20000);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    return sky;
  }

  /** Slide the rendered image sideways (fraction of width) so a text column can own one side. */
  setFrameShift(fraction: number) {
    this.shift = fraction;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.applyShift(w, h);
    this.camera.updateProjectionMatrix();
  }

  private applyShift(w: number, h: number) {
    if (this.shift) this.camera.setViewOffset(w, h, -w * this.shift, 0, w, h);
    else this.camera.clearViewOffset();
  }

  /** Build the circuit for a session. The lap paints the rubber line. */
  /** The session the scene is built for, so a page can reuse it instead of rebuilding. */
  get sessionShown(): number {
    return this.sessionKey;
  }

  setSession(session: Session) {
    this.session = session;
    this.lapLine = null; // the next setLap fills it; the track itself uses the plain line
    this.ghostLine = null;
    this.snap = true;
    this.sessionKey = session.key;
    this.groundAreas = undefined;
    this.setLight("day");
    this.trackGroup.clear();
    this.labels = [];
    this.line = null;
    const { x, y, z, step } = session.track;
    const n = x.length;
    const cx = (Math.max(...x) + Math.min(...x)) / 2;
    const cy = (Math.max(...y) + Math.min(...y)) / 2;
    const zmin = Math.min(...z);
    const rot = THREE.MathUtils.degToRad(session.rotation || 0);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const base = FLOAT;
    // Track coordinates to the scene, kept so map features can be placed the same way.
    this.toScene = (tx, ty) => {
      const px = tx - cx;
      const py = ty - cy;
      return new THREE.Vector2(px * cos - py * sin, -(px * sin + py * cos));
    };
    const pos = Array.from({ length: n }, (_, i) => {
      const px = x[i] - cx;
      const py = y[i] - cy;
      // Data is x east, y north. Rotate to the broadcast map orientation, then map to three's xz plane.
      return new THREE.Vector3(px * cos - py * sin, (z[i] - zmin) * ELEVATION + base, -(px * sin + py * cos));
    });
    // The reference line carries small sideways wiggles from the position data; a short triangular
    // average removes them without visibly cutting corners (4 m spacing, weights 1-2-3-2-1).
    const raw = pos.map((p) => p.clone());
    const weights = [1, 2, 3, 2, 1];
    for (let i = 0; i < n; i++) {
      let x = 0;
      let zz = 0;
      weights.forEach((w, k) => {
        const q = raw[(i + k - 2 + n) % n];
        x += q.x * w;
        zz += q.z * w;
      });
      pos[i].x = x / 9;
      pos[i].z = zz / 9;
    }
    // Heights jump by up to a metre between 4 m samples; the car rode those as bumps. Two passes of
    // a 60 m moving average keep real hills and crests but make the surface a road.
    const half = Math.round(30 / step);
    for (let pass = 0; pass < 2; pass++) {
      const ys = pos.map((p) => p.y);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -half; k <= half; k++) sum += ys[(i + k + n) % n];
        pos[i].y = sum / (2 * half + 1);
      }
    }
    // The ground's height comes from the road's natural height (before any bridge is lifted).
    this.terrainSamples = pos.filter((_, i) => i % 6 === 0).map((p) => ({ x: p.x, z: p.z, y: p.y }));
    raiseCrossings(pos, step);
    // Headings over ±12 m, so the car and camera never twitch on a straight.
    const tan = pos.map((_, i) => pos[(i + 3) % n].clone().sub(pos[(i - 3 + n) % n]).setY(0).normalize());
    const side = tan.map((t) => new THREE.Vector3(-t.z, 0, t.x));
    const s = pos.map((_, i) => i * step);
    const edges = trackEdges(pos, tan, side, step);
    this.frame = { pos, tan, side, s, length: session.length, line: racingLine(pos, side, step, edges, session.corners.map((c) => c.s)), edges };
    this.radius = Math.max(...pos.map((p) => Math.hypot(p.x, p.z)));

    this.trackGroup.add(
      this.buildGround(session),
      this.buildStrip(),
      this.buildKerbs(session),
      this.buildBarriers(),
      this.buildBrakeBoards(session),
      this.buildStartLine(),
      this.buildRubber(session),
    );
    for (const [k, c] of session.corners.entries()) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture(`T${c.n}`, this.labelInk), transparent: true, opacity: 0.55, depthWrite: false }),
      );
      const p = this.pointAt(c.s);
      const sd = this.sideAt(c.s);
      const turn = this.turnSign(c.s);
      sprite.position.copy(p).addScaledVector(sd, -turn * 34).setY(p.y + 14);
      this.trackGroup.add(sprite);
      this.labels[k] = { sprite, n: c.n, s: c.s, aspect: 2, read: false };
    }

    const r = this.radius;
    this.shadowNear = null; // set up again for this circuit on the next frame
    // Close enough that the far side of the circuit melts into the haze from the chase camera.
    this.scene.fog = new THREE.Fog((this.dark ? EVENING : DAY).haze, Math.min(r * 0.9, 900), Math.max(r * 2.6, 2600));
    void this.loadSurroundings(session.key);
  }

  private buildGround(session: Session): THREE.Mesh {
    // Big enough to reach every real feature (up to 900 m from the track).
    const size = Math.max(this.radius * 2.9, 2 * (this.radius + 1000));
    this.groundSize = size;
    this.groundText = [session.circuit, session.date.slice(0, 4)];
    this.groundMat = groundDetail(new THREE.MeshStandardMaterial({ map: posterGround(...this.groundText, false), roughness: 0.95 }), false);
    this.groundKey = "plain";
    this.groundMat.color.setScalar(this.skyDark ? GROUND_DIM : 1);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.groundMesh = ground;
    return ground;
  }

  /** Fetch and place the circuit's real surroundings; a late answer for an older circuit is dropped. */
  private async loadSurroundings(key: number) {
    const index = await loadEnvIndex();
    const es = index[String(key)];
    if (!es || key !== this.sessionKey) return;
    let env: EnvData;
    try {
      env = await loadEnv(es.env);
    } catch {
      return; // no surroundings: the plain ground stays
    }
    if (key !== this.sessionKey || !this.frame) return;
    await this.applySurroundings(env, es);
  }

  /** Builds the surroundings in steps, one per frame (ground, buildings, stands, trackside,
   * trees), so the scene never freezes for half a second; each step stops if the visitor has
   * already moved on to another circuit. */
  async applySurroundings(env: EnvData, es: EnvSession) {
    const key = this.sessionKey;
    // The next frame, or 50 ms in a hidden tab (which gets no frames), so building never stalls.
    const nextFrame = () =>
      new Promise<void>((r) => {
        const t = setTimeout(r, 50);
        requestAnimationFrame(() => {
          clearTimeout(t);
          r();
        });
      });
    const stale = () => key !== this.sessionKey;
    const toTrack = mapToTrack(es);
    const toScene = (x: number, y: number) => {
      const [tx, ty] = toTrack(x, y);
      return this.toScene(tx, ty);
    };
    const size = this.groundSize;
    const terrain = new Terrain(size, 140, this.terrainSamples, 0.6);
    this.terrain = terrain;
    await nextFrame();
    if (stale()) return;
    // Water, woods and parks are printed into the ground texture, so they lie on the terrain.
    const px = (polys: number[][][]) =>
      polys.map((rings) =>
        rings.map((r) => {
          const out: number[] = [];
          for (let i = 0; i < r.length; i += 2) {
            const p = toScene(r[i], r[i + 1]);
            out.push(((p.x + size / 2) / size) * GROUND_PX, ((p.y + size / 2) / size) * GROUND_PX);
          }
          return out;
        }),
      );
    const k = GROUND_PX / size;
    const f = this.frame!;
    const verge = f.pos.flatMap((p) => [(p.x + size / 2) * k, (p.z + size / 2) * k]);
    this.groundAreas = {
      water: px(env.water),
      wood: px(env.wood),
      grass: px(env.grass),
      gravel: px(env.gravel ?? []),
      tarmac: px(env.tarmac ?? []),
      // Verges: about 35 m of grass each side at a permanent circuit, 12 m of pavement in a street.
      verge: { line: verge, width: (env.street ? 24 : 70) * k + TRACK_WIDTH * k, street: !!env.street },
    };
    if (this.groundMesh && this.groundMat) {
      this.trackGroup.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
      this.groundMesh = terrain.mesh(this.groundMat);
      this.trackGroup.add(this.groundMesh);
    }
    await nextFrame();
    if (stale()) return;
    this.trackGroup.add(this.buildVerge(terrain, !!env.street));
    await nextFrame();
    if (stale()) return;
    // Plain ground in the base colour out to the horizon, so the edge of the map never shows.
    let low = Infinity;
    for (const h of terrain.heights) low = Math.min(low, h);
    this.outerStreet = !!env.street;
    this.applyPalette();
    const outer = new THREE.Mesh(new THREE.RingGeometry(size * 0.49, 40000, 64, 1).rotateX(-Math.PI / 2), this.outerMat);
    outer.position.y = low - 0.5;
    outer.receiveShadow = false;
    this.trackGroup.add(outer);
    const g = new THREE.Group();
    this.envGroup = g;
    this.trackGroup.add(g);
    await nextFrame();
    if (stale()) return;
    // Everything from the map is placed in scene coordinates and kept clear of the track first.
    const clear = new TrackClearance(f.pos);
    this.clearance = clear;
    const id = (x: number, y: number) => new THREE.Vector2(x, y);
    const buildings: EnvData["buildings"] = [];
    for (const b of env.buildings) {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < b[3].length; i += 2) pts.push(toScene(b[3][i], b[3][i + 1]));
      const fitted = pts.length >= 3 ? clear.fit(pts) : null;
      if (fitted) buildings.push([b[0], b[1], b[2], fitted.flatMap((p) => [p.x, p.y]), b[4], b[5]]);
    }
    // Buildings, and grandstand roofs mapped as raised canopies; stands on the ground are seating.
    await nextFrame();
    if (stale()) return;
    const plain = buildingsMesh(buildings, false, id, terrain, this.envMats.building);
    if (plain) g.add(plain);
    const canopies = buildingsMesh(buildings.filter((b) => b[1] > 0), true, id, terrain, this.envMats.stand);
    if (canopies) g.add(canopies);
    const pts = f.pos;
    const nearest = (x: number, z: number) => {
      let best = pts[0];
      let bd = Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2;
        if (d < bd) {
          bd = d;
          best = pts[i];
        }
      }
      return new THREE.Vector2(best.x, best.z);
    };
    // A spectator is half a body wide: the middle of the seat stays that much further back.
    const seatOk = (x: number, z: number) => clear.near(x, z).d >= TrackClearance.CLEAR + 0.6;
    await nextFrame();
    if (stale()) return;
    g.add(standsGroup(buildings, id, terrain, nearest, this.envMats.stand, this.envMats.crowd, 22000, seatOk));
    this.showCrowds();
    await nextFrame();
    if (stale()) return;
    // Trackside first, so no tree grows through a stand it places.
    const lively = this.buildLiveliness(env, buildings, toScene, terrain, nearest);
    g.add(lively.group);
    this.showCrowds();
    const trees: number[] = [];
    for (let i = 0; i < env.trees.length; i += 2) {
      const p = toScene(env.trees[i], env.trees[i + 1]);
      // A crown is up to 3.6 m across the middle of the tree: keep the whole crown clear.
      if (!lively.covers(p.x, p.y) && clear.near(p.x, p.y).d >= TrackClearance.CLEAR + 3.6) trees.push(env.trees[i], env.trees[i + 1]);
    }
    await nextFrame();
    if (stale()) return;
    g.add(treesGroup(trees, toScene, terrain, this.envMats.crown, this.envMats.trunk));
    for (const [x, y, h] of env.wheels) {
      const p = toScene(x, y);
      const { d, p: at } = clear.near(p.x, p.y);
      if (d < TrackClearance.CLEAR + 2) continue;
      const wheel = wheelMesh(p.x, p.y, h, terrain.at(p.x, p.y), this.envMats.wheel);
      // Face the track, so the wheel runs alongside it and never leans over the road.
      if (at) wheel.rotation.y = Math.atan2(at.x - p.x, at.z - p.y);
      g.add(wheel);
    }
    this.setLight(es.light);
    this.surroundingsFor = key;
  }

  /** The verge: level with the road from its edge out to 14 m (past the barriers, fence and
   * boards, so they stand on it), then sloping down to the ground by 28 m. The track is a raised
   * strip and the ground is kept below it, so without this the barriers floated over a drop.
   * Where another part of the track runs within 30 m at another height (Suzuka's bridge), the
   * verge stays level and short, so it never slopes across the road below. */
  private buildVerge(terrain: Terrain, street: boolean): THREE.Mesh {
    const f = this.frame!;
    const n = f.pos.length;
    const apart = Math.ceil(300 / (f.s[1] - f.s[0] || 4));
    const crowded = new Uint8Array(n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const sep = Math.abs(i - j);
        if (Math.min(sep, n - sep) < apart) continue;
        const a = f.pos[i];
        const b = f.pos[j];
        if (Math.abs(a.y - b.y) > 3 && (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 900) {
          crowded[i] = 1;
          break;
        }
      }
    const pos: number[] = [];
    const idx: number[] = [];
    const row = 4; // vertices per side per point: road edge, level end, two along the slope
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const p = f.pos[k];
      const sd = f.side[k];
      for (const [sign, e] of [[1, 0], [-1, 1]] as const) {
        const edge = f.edges.half[e][k];
        const level = f.edges.open[e][k] ? Math.max(edge + 1, 14) : f.edges.wall[e][k] + 0.3;
        const out = f.edges.open[e][k] && !crowded[k] ? 28 : level + 0.01;
        const y = p.y - 0.03;
        const at = (d: number) => [p.x + sd.x * d * sign, p.z + sd.z * d * sign];
        const [ox, oz] = at(out);
        const low = Math.min(terrain.at(ox, oz) + 0.05, y);
        const [mx, mz] = at((level + out) / 2);
        const mid = Math.min(terrain.at(mx, mz) + 0.05, y + (low - y) * 0.5);
        for (const [d, h] of [[edge, y], [level, y], [(level + out) / 2, mid], [out, low]] as const) {
          const [x, z] = at(d);
          pos.push(x, h, z);
        }
      }
      if (i < n) {
        const a = i * row * 2;
        const b = a + row * 2;
        for (const off of [0, row]) {
          for (let q = 0; q < row - 1; q++) {
            const v0 = a + off + q;
            const v1 = b + off + q;
            // Wound so the top faces up on both sides of the road.
            if (off === 0) idx.push(v0, v1, v0 + 1, v0 + 1, v1, v1 + 1);
            else idx.push(v0, v0 + 1, v1, v0 + 1, v1 + 1, v1);
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.vergeMat.color.set(street ? "#b9b6af" : "#93b874");
    this.vergeMat.userData.stripes.value = street ? 0 : 1;
    this.vergeStreet = street;
    const m = new THREE.Mesh(geo, this.vergeMat);
    m.receiveShadow = true;
    return m;
  }

  /** What every broadcast shows that the map does not: grandstands where the map has few, crowd
   * banks at the slow corners, boards along the straights, marshal posts. Only on free ground. */
  private buildLiveliness(
    env: EnvData,
    buildings: EnvData["buildings"], // already in scene coordinates and clear of the track
    toScene: (x: number, y: number) => THREE.Vector2,
    terrain: Terrain,
    nearest: (x: number, z: number) => THREE.Vector2,
  ): { group: THREE.Group; covers: (x: number, z: number) => boolean } {
    const f = this.frame!;
    const g = new THREE.Group();
    const occ = new Occupancy(this.groundSize);
    for (const p of f.pos) occ.disc(p.x, p.z, TRACK_WIDTH / 2 + 5);
    let mappedNear = 0;
    for (const [, , stand, flat] of buildings) {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
      occ.polygon(pts);
      if (stand && pts.length && nearest(pts[0].x, pts[0].y).distanceTo(pts[0]) < 80) mappedNear++;
    }
    for (const rings of env.water) {
      const r = rings[0];
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < r.length; i += 2) pts.push(toScene(r[i], r[i + 1]));
      occ.polygon(pts);
    }
    const session = this.session!;
    const placed: EnvData["buildings"] = [];
    // A stand beside the track at distance s, on side `sign` (+1 = +side): length along the track,
    // depth away from it, height at the back.
    const tryStand = (s: number, sign: number, length: number, depth: number, height: number) => {
      const i = this.nearestIndex(s);
      const e = sign > 0 ? 0 : 1;
      if (!f.edges.open[e][i]) return;
      const p = this.pointAt(s);
      const t = this.headingAt(s);
      const sd = this.sideAt(s);
      const along = new THREE.Vector2(t.x, t.z);
      const c = new THREE.Vector2(p.x, p.z).addScaledVector(new THREE.Vector2(sd.x, sd.z), sign * (f.edges.wall[e][i] + 7 + depth / 2));
      if (occ.claim(c, along, length + 6, depth + 4)) placed.push([height, 0, 1, rectangle(c, along, length, depth), "#3d4650", "#c23b30"]);
    };
    // Corners with the longest braking: where the overtaking is, and so where the crowds sit.
    const heavy = session.corners
      .map((c, k) => ({ c, k, brake: session.field.med[k]?.[0] ?? 0 }))
      .filter((x) => x.c.braked)
      .sort((a, b) => (a.brake ?? 0) - (b.brake ?? 0))
      .slice(0, 6);
    if (mappedNear < 10) {
      // Few real stands mapped (street circuits): build them where every circuit has them.
      for (const s of [-60, 60]) for (const sign of [1, -1]) tryStand((s + f.length) % f.length, sign, 90, 16, 11);
      for (const { c } of heavy.slice(0, 5)) tryStand(c.s - 45, -this.turnSign(c.s), 80, 14, 10);
    }
    // Spectator banks at the slow corners, low terraces behind the fence, at every circuit.
    for (const { c } of heavy) tryStand(c.s + 10, -this.turnSign(c.s), 50, 8, 3.2);
    if (placed.length) {
      const seatOk = (x: number, z: number) => (this.clearance?.near(x, z).d ?? Infinity) >= TrackClearance.CLEAR + 0.6;
      g.add(standsGroup(placed, (x, y) => new THREE.Vector2(x, y), terrain, nearest, this.envMats.stand, this.envMats.crowd, 9000, seatOk));
    }

    // Boards on the fence along the straights (where the heading barely changes), every 24 m.
    const list: { p: THREE.Vector3; yaw: number }[] = [];
    for (let s = 0; s < f.length; s += 24) {
      const a = this.headingAt(s - 30);
      const b = this.headingAt(s + 30);
      if (a.dot(b) < Math.cos(THREE.MathUtils.degToRad(6))) continue;
      const i = this.nearestIndex(s);
      const p = this.pointAt(s);
      const t = this.headingAt(s);
      const sd = this.sideAt(s);
      for (const [sign, e] of [[1, 0], [-1, 1]] as const) {
        if (!f.edges.open[e][i] || (s / 24 + e) % 2 === 1) continue;
        list.push({ p: p.clone().addScaledVector(sd, sign * (TRACK_WIDTH / 2 + 4.3)), yaw: Math.atan2(-t.z, t.x) });
      }
    }
    const board = boards(list);
    if (board) {
      board.userData.furniture = true; // stands on the fence by design
      g.add(board);
    }

    // Marshal posts every 300 m, alternating sides, where there is room.
    const posts: { p: THREE.Vector3; yaw: number }[] = [];
    for (let s = 150, k = 0; s < f.length; s += 300, k++) {
      const sign = k % 2 ? 1 : -1;
      const e = sign > 0 ? 0 : 1;
      const i = this.nearestIndex(s);
      if (!f.edges.open[e][i]) continue;
      const p = this.pointAt(s);
      const t = this.headingAt(s);
      const sd = this.sideAt(s);
      const at = p.clone().addScaledVector(sd, sign * (f.edges.wall[e][i] + 3));
      if (!occ.claim(new THREE.Vector2(at.x, at.z), new THREE.Vector2(t.x, t.z), 4, 4)) continue;
      posts.push({ p: at, yaw: Math.atan2(-t.z, t.x) });
    }
    const marshals = marshalPosts(posts);
    marshals.userData.furniture = true;
    g.add(marshals);
    const footprints = placed.map(([, , , flat]) => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
      return pts;
    });
    return { group: g, covers: (x, z) => footprints.some((pts) => inside(pts, x, z)) };
  }

  /** Day, dusk or night, from the session's real start time at the circuit. At night the sky is
   * dark and floodlights line the track, whatever the page theme. */
  private setLight(mode: "day" | "dusk" | "night") {
    this.lightMode = mode;
    if (this.floodlights) {
      this.trackGroup.remove(this.floodlights);
      this.floodlights = null;
    }
    if (mode === "night" && this.frame) {
      this.floodlights = this.buildFloodlights();
      this.trackGroup.add(this.floodlights);
    }
    this.applyPalette();
    this.refreshInk();
  }

  /** The sky is dark in the dark theme and at a night race. */
  private get skyDark(): boolean {
    return this.dark || this.lightMode === "night";
  }

  /** Floodlight masts every 90 m on alternate sides, where there is room; bright heads glow. */
  private buildFloodlights(): THREE.Group {
    const f = this.frame!;
    const g = new THREE.Group();
    const count = Math.floor(f.length / 90);
    const masts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 16, 0.4).translate(0, 8, 0), new THREE.MeshStandardMaterial({ color: "#3a3936" }), count);
    // Slim heads: big ones bloomed into glowing blocks in the TV camera.
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.5, 2.0), new THREE.MeshBasicMaterial({ color: "#f4eedb" }), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let i = 0; i < count; i++) {
      const s = i * 90;
      const sign = i % 2 ? 1 : -1;
      const e = sign > 0 ? 0 : 1;
      const idx = this.nearestIndex(s);
      if (!f.edges.open[e][idx]) continue;
      const p = this.pointAt(s);
      const t = this.headingAt(s);
      const at = p.clone().addScaledVector(this.sideAt(s), sign * (f.edges.wall[e][idx] + 2.5));
      q.setFromAxisAngle(up, Math.atan2(-t.z, t.x));
      m.compose(at, q, new THREE.Vector3(1, 1, 1));
      masts.setMatrixAt(k, m);
      m.compose(at.clone().setY(at.y + 16.4), q, new THREE.Vector3(1, 1, 1));
      heads.setMatrixAt(k++, m);
    }
    masts.count = heads.count = k;
    g.add(masts, heads);
    return g;
  }

  /** Sky, fog, lights and surroundings in the colours of the theme and the time of day. */
  private applyPalette() {
    const dark = this.skyDark;
    const evening = this.dark && this.lightMode === "day";
    const p = this.lightMode === "dusk" ? DUSK : evening ? EVENING : dark ? NIGHT : DAY;
    this.scene.background = p.background;
    (this.scene.fog as THREE.Fog).color.copy(p.haze);
    this.sky.material.uniforms.uZenith.value.copy(p.zenith);
    this.sky.material.uniforms.uHorizon.value.copy(p.horizon);
    this.sky.material.uniforms.uCloud.value = this.lightMode === "dusk" ? 0.6 : evening ? 0.55 : dark ? 0 : 1;
    this.sky.material.uniforms.uCloudLit.value = evening ? 0.16 : 1;
    this.sky.material.uniforms.uStars.value = this.lightMode === "night" ? 1 : 0;
    const night = this.lightMode === "night";
    // Floodlit at night: an even, white light from above; the sun becomes a dim moon.
    this.hemi.intensity = night ? 1.6 : dark ? 0.9 : 1.4;
    // Fill light from a blue sky above and green-brown ground below, so shadows have colour.
    this.hemi.color.set(night ? "#f2f4ff" : evening ? "#9fb2d6" : dark ? "#ffffff" : "#c4dcf5");
    this.hemi.groundColor.set(dark ? "#2a2926" : "#7a7556");
    if (!night && !dark) this.hemi.intensity = 1.15;
    this.sun.intensity = night ? 0.5 : this.lightMode === "dusk" ? 2.0 : evening ? 2.3 : 3.8;
    this.sun.color.set(night ? "#b8c6ff" : this.lightMode === "dusk" ? "#ffb070" : evening ? "#ffd7b0" : "#ffefd2");
    const m = this.envMats;
    // In the dark theme or at night the colours stay, dimmed, so the scene keeps its colour.
    const dim = dark ? 0.45 : 1;
    m.building.color.setScalar(dim);
    m.stand.color.setScalar(dim);
    m.crown.color.setScalar(dark ? 0.55 : 1);
    m.crowd.color.setScalar(dark ? 0.5 : 1);
    this.outerMat.color.set(this.outerStreet ? "#c3c0b8" : "#bdbd94");
    this.vergeMat.color.set(this.vergeStreet ? "#b9b6af" : "#93b874");
    if (dark) this.vergeMat.color.multiplyScalar(0.3);
    if (dark) this.outerMat.color.multiplyScalar(0.18);
    m.crowd.emissive.set(night ? "#2a2620" : "#000000");
    m.trunk.color.set(dark ? "#3a322b" : "#6b5d4f");
    m.wheel.color.set(dark ? "#8f8c86" : "#3a3936");
    // A city at night is lit: a faint warm glow keeps buildings and stands readable on the dark.
    // At night a share of the windows are lit (the emissive map); the walls stay dark.
    m.building.emissive.set(night ? "#ffffff" : "#000000");
    m.building.emissiveIntensity = night ? 0.9 : 0;
    m.stand.emissive.set(night ? "#1f1d1a" : "#000000");
    m.wheel.emissive.set(night ? "#4a4030" : "#000000");
    const key = this.groundAreas ? String(this.sessionKey) : "plain";
    if (this.groundMat && key !== this.groundKey) {
      this.groundKey = key;
      this.groundMat.map?.dispose();
      this.groundMat.map = posterGround(...this.groundText, false, this.groundAreas);
      this.groundMat.needsUpdate = true;
    }
    this.groundMat?.color.setScalar(dark ? GROUND_DIM : 1);
    this.refreshReflections(p, night);
  }

  /** A small image of the sky over the ground, with the sun in it, for the car to reflect: glossy
   * paint that mirrors the sky reads as a real car, flat paint as a toy. Made again whenever the
   * sky changes (theme, time of day), which takes a few milliseconds. */
  private refreshReflections(p: { zenith: THREE.Vector3; horizon: THREE.Vector3 }, night: boolean) {
    this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
    const toColor = (v: THREE.Vector3) => new THREE.Color().setRGB(v.x, v.y, v.z, THREE.LinearSRGBColorSpace);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: toColor(p.zenith) },
        uHorizon: { value: toColor(p.horizon).multiplyScalar(1.1) },
        uGround: { value: this.hemi.groundColor.clone().multiplyScalar(0.35) },
        uSun: { value: SUN_DIR },
        uSunColor: { value: this.sun.color.clone().multiplyScalar(night ? 0 : this.sun.intensity * 4) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uGround, uSun, uSunColor;
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 c = y > 0.0 ? mix(uHorizon, uTop, smoothstep(0.0, 0.55, y)) : mix(uHorizon, uGround, smoothstep(0.0, -0.12, y));
          c += uSunColor * pow(max(dot(vDir, uSun), 0.0), 300.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const scene = new THREE.Scene();
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
    scene.add(sphere);
    const next = this.pmrem.fromScene(scene, 0, 0.1, 100);
    sphere.geometry.dispose();
    mat.dispose();
    this.reflections?.dispose();
    this.reflections = next;
    this.applyReflections();
  }

  /** Give the car's paint, carbon and rims the sky to reflect (both cars). */
  private applyReflections() {
    const env = this.reflections?.texture ?? null;
    if (!this.car || !this.ghost) return; // the palette can be set before the cars exist
    for (const g of [this.car, this.ghost])
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
        if (!m.envMap !== !env) m.needsUpdate = true;
        m.envMap = env;
        m.envMapIntensity = m.userData.paint ? 0.9 : 0.5;
      });
  }

  /** Raised asphalt strip with rubber sides, following the real elevation. */
  private buildStrip(): THREE.Group {
    const f = this.frame!;
    const n = f.pos.length;
    const top: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const p = f.pos[k];
      const sd = f.side[k];
      const sv = i === n ? f.length : f.s[k];
      const [h0, h1] = [f.edges.half[0][k], f.edges.half[1][k]];
      top.push(p.x + sd.x * h0, p.y, p.z + sd.z * h0, p.x - sd.x * h1, p.y, p.z - sd.z * h1);
      uv.push(0, sv / 14, 1, sv / 14);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(top, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = asphaltTexture();
    tex.repeat.set(1, 1);
    const asphalt = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: tex, color: "#9a9893", roughness: 0.86, metalness: 0.05 }),
    );
    asphalt.receiveShadow = true;
    asphalt.castShadow = true;

    // Side walls down to the ground, rubber black, so the strip reads as a solid object.
    const wall: number[] = [];
    const widx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const p = f.pos[k];
      const sd = f.side[k];
      for (const sign of [1, -1]) {
        const h = f.edges.half[sign > 0 ? 0 : 1][k];
        const ex = p.x + sd.x * h * sign;
        const ez = p.z + sd.z * h * sign;
        wall.push(ex, p.y, ez, ex, p.y - STRIP_DEPTH, ez);
      }
      if (i < n) {
        const a = i * 4;
        widx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4, a + 2, a + 6, a + 3, a + 3, a + 6, a + 7);
      }
    }
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
    wgeo.setIndex(widx);
    wgeo.computeVertexNormals();
    const walls = new THREE.Mesh(
      wgeo,
      // Concrete, not black: where two sections run side by side at different heights (Baku), this
      // side is what the camera sees, and black read as a hole in the world.
      new THREE.MeshStandardMaterial({ color: "#8f8c86", roughness: 0.9, side: THREE.DoubleSide }),
    );
    walls.castShadow = true;

    // Painted white edge lines.
    const edges = new THREE.Group();
    for (const sign of [1, -1]) {
      const pts = [...f.pos, f.pos[0]].map((p, i) => {
        const sd = f.side[i % n];
        const h = f.edges.half[sign > 0 ? 0 : 1][i % n] - 0.6;
        return new THREE.Vector3(p.x + sd.x * h * sign, p.y + 0.05, p.z + sd.z * h * sign);
      });
      edges.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: "#d8d6d0", transparent: true, opacity: 0.5 }),
        ),
      );
    }
    const g = new THREE.Group();
    g.add(asphalt, walls, edges);
    return g;
  }

  /** Striped kerbs on the inside of every corner, hard white and rubber grey. */
  /** Low barrier blocks along both sides of the whole lap, alternating colour. They are what the
   * eye reads speed from: at 300 km/h one passes every 70 ms. */
  private buildBarriers(): THREE.Group {
    const f = this.frame!;
    const g = new THREE.Group();
    const spacing = 6;
    const count = Math.floor(f.length / spacing);
    const geo = new THREE.BoxGeometry(spacing - 0.4, 0.9, 0.5);
    const makeSet = (colour: THREE.ColorRepresentation) => {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 }), count);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      return mesh;
    };
    const light = makeSet(BARRIER_LIGHT);
    const dark = makeSet(BARRIER_DARK);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let nl = 0;
    let nd = 0;
    for (let k = 0; k < count; k++) {
      const s = k * spacing + spacing / 2;
      const p = this.pointAt(s);
      const t = this.headingAt(s);
      q.setFromAxisAngle(up, Math.atan2(-t.z, t.x));
      const i = this.nearestIndex(s);
      for (const sign of [1, -1]) {
        const e = sign > 0 ? 0 : 1;
        if (!f.edges.drawWall[e][i]) continue;
        const at = p.clone().addScaledVector(this.sideAt(s), sign * f.edges.wall[e][i]).setY(p.y + 0.45);
        m.compose(at, q, new THREE.Vector3(1, 1, 1));
        if (k % 2 === 0) light.setMatrixAt(nl++, m);
        else dark.setMatrixAt(nd++, m);
      }
    }
    light.count = nl;
    dark.count = nd;
    g.add(light, dark);

    // Catch-fence posts every 12 m with a top rail: tall things at the edge of the view are what
    // the eye reads speed from, far more than the road itself.
    const postSpacing = 12;
    const postCount = Math.floor(f.length / postSpacing);
    const posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 4, 0.16),
      new THREE.MeshStandardMaterial({ color: "#6b6a66", roughness: 0.7 }),
      postCount * 2,
    );
    const offset = TRACK_WIDTH / 2 + 4.6;
    let np = 0;
    // Rails run between consecutive posts on each side; another road alongside breaks them.
    const rails: THREE.Vector3[][][] = [[[]], [[]]];
    for (let k = 0; k <= postCount; k++) {
      const s = (k % postCount) * postSpacing;
      const p = this.pointAt(s);
      const sd = this.sideAt(s);
      const i = this.nearestIndex(s);
      [1, -1].forEach((sign, r) => {
        const runs = rails[r];
        if (!f.edges.open[r][i]) {
          if (runs[runs.length - 1].length) runs.push([]);
          return;
        }
        const at = p.clone().addScaledVector(sd, sign * offset);
        if (k < postCount) {
          m.makeTranslation(at.x, p.y + 2, at.z);
          posts.setMatrixAt(np++, m);
        }
        runs[runs.length - 1].push(at.setY(p.y + 4));
      });
    }
    posts.count = np;
    g.add(posts);
    const railMat = new THREE.LineBasicMaterial({ color: "#6b6a66" });
    for (const runs of rails)
      for (const pts of runs) if (pts.length > 1) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), railMat));
    return g;
  }

  /** The start/finish line: a chequered strip across the road and a gantry over it carrying the
   * five start lights, as at every circuit. */
  private buildStartLine(): THREE.Group {
    const f = this.frame!;
    const g = new THREE.Group();
    const p = this.pointAt(0);
    const t = this.headingAt(0);
    const yaw = Math.atan2(-t.z, t.x);
    const hL = f.edges.half[0][0];
    const hR = f.edges.half[1][0];
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 32;
    const x = c.getContext("2d")!;
    for (let i = 0; i < 16; i++)
      for (let j = 0; j < 2; j++) {
        x.fillStyle = (i + j) % 2 ? "#111111" : "#f4f4f2";
        x.fillRect(i * 16, j * 16, 16, 16);
      }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.6, hL + hR).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    tex.rotation = Math.PI / 2;
    tex.center.set(0.5, 0.5);
    const sd = this.sideAt(0);
    strip.position.copy(p).addScaledVector(sd, (hL - hR) / 2).setY(p.y + 0.06);
    strip.rotation.y = yaw;
    strip.receiveShadow = true;
    g.add(strip);
    // Gantry: two posts outside the barriers and a beam across at 7 m with the light pod.
    const ink = new THREE.MeshStandardMaterial({ color: "#2a2a2a", roughness: 0.6, metalness: 0.3 });
    const span = f.edges.wall[0][0] + f.edges.wall[1][0] + 1;
    for (const [sign, e] of [[1, 0], [-1, 1]] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.6, 0.6).translate(0, 3.8, 0), ink);
      post.position.copy(p).addScaledVector(sd, sign * (f.edges.wall[e][0] + 0.5));
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, span), ink);
    beam.position.copy(p).addScaledVector(sd, (f.edges.wall[0][0] - f.edges.wall[1][0]) / 2).setY(p.y + 7.2);
    beam.rotation.y = yaw;
    beam.castShadow = true;
    g.add(beam);
    const pod = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 5.2), new THREE.MeshStandardMaterial({ color: "#111111", roughness: 0.4 }));
    pod.position.copy(p).setY(p.y + 6.3);
    pod.rotation.y = yaw;
    g.add(pod);
    const lamp = new THREE.MeshBasicMaterial({ color: "#5a0d0a" });
    for (let k = 0; k < 5; k++) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), lamp);
      // Facing the cars as they arrive (the side the lap ends from).
      l.position.copy(p).addScaledVector(t, -0.66).addScaledVector(sd, (k - 2) * 0.95).setY(p.y + 6.3);
      l.rotation.y = yaw - Math.PI / 2;
      g.add(l);
    }
    return g;
  }

  /** Dark rubber laid down on the racing line in every braking zone: 120 m before each braked
   * corner, darkest where the braking is hardest, as on any circuit after a weekend's running. */
  private buildRubber(session: Session): THREE.Mesh {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const w = 0.95;
    for (const c of session.corners) {
      if (!c.braked) continue;
      const base = pos.length / 3;
      const steps = 30;
      for (let k = 0; k <= steps; k++) {
        const s = c.s - 130 + (k / steps) * 120;
        const p = this.carPointAt(s);
        const sd = this.sideAt(s);
        for (const o of [-w, w]) pos.push(p.x + sd.x * o, p.y + 0.04, p.z + sd.z * o);
        // Fades in toward the corner and out at the very start of the zone.
        const a = Math.sin((k / steps) * Math.PI * 0.5) ** 1.5;
        col.push(a, a);
        if (k < steps) {
          const q = base + k * 2;
          idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aStrength", new THREE.Float32BufferAttribute(col, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      vertexShader: /* glsl */ `
        attribute float aStrength; varying float vA; varying vec2 vUv;
        void main() { vA = aStrength; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { gl_FragColor = vec4(0.05, 0.05, 0.05, 0.42 * vA); }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 1;
    return m;
  }

  /** 150, 100 and 50 m boards before every heavy-braking corner, on the outside. The numbers are
   * the true distance to the corner marker. */
  private buildBrakeBoards(session: Session): THREE.Group {
    const g = new THREE.Group();
    const textures = new Map<number, THREE.CanvasTexture>();
    for (const [k, c] of session.corners.entries()) {
      const brakePoint = session.field.med[k]?.[0];
      if (!c.braked || brakePoint == null || brakePoint > -60) continue;
      const turn = this.turnSign(c.s);
      for (const d of [150, 100, 50]) {
        const s = c.s - d;
        if (!textures.has(d)) textures.set(d, boardTexture(String(d)));
        const board = new THREE.Mesh(
          new THREE.PlaneGeometry(2.6, 1.7),
          new THREE.MeshStandardMaterial({ map: textures.get(d), roughness: 0.7 }),
        );
        const p = this.pointAt(s);
        const t = this.headingAt(s);
        if (!this.frame!.edges.open[-turn > 0 ? 0 : 1][this.nearestIndex(s)]) continue;
        board.position.copy(p).addScaledVector(this.sideAt(s), -turn * (TRACK_WIDTH / 2 + 5)).setY(p.y + 2.2);
        // Face the cars coming towards it.
        board.rotation.y = Math.atan2(-t.z, t.x) - Math.PI / 2;
        g.add(board);
      }
    }
    return g;
  }

  private buildKerbs(session: Session): THREE.Group {
    const g = new THREE.Group();
    const mats = [
      new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: RED, roughness: 0.6 }),
    ];
    // Low and flat, as real kerbs are (a few centimetres proud of the road), not blocks.
    const box = new THREE.BoxGeometry(3.2, 0.1, 1.6);
    for (const c of session.corners) {
      const turn = this.turnSign(c.s);
      let k = 0;
      for (let s = c.s - 28; s <= c.s + 28; s += 3.2, k++) {
        const p = this.pointAt(s);
        const t = this.tangentAt(s);
        const sd = this.sideAt(s);
        const e = turn > 0 ? 0 : 1;
        const i = this.nearestIndex(s);
        if (!this.frame!.edges.open[e][i]) continue;
        const m = new THREE.Mesh(box, mats[k % 2]);
        m.position.copy(p).addScaledVector(sd, turn * (this.frame!.edges.half[e][i] + 0.8)).setY(p.y + 0.02);
        m.rotation.y = Math.atan2(-t.z, t.x);
        m.receiveShadow = true;
        g.add(m);
      }
    }
    return g;
  }

  /** Paint the lap's rubber line: red under braking, paper white at full throttle. */
  setLap(lap: LapData) {
    // How this lap drove each corner against the field: the shape of its line (carPointAt).
    const session = this.session;
    this.lapLine = session ? this.buildLapLine(lineShape(lap, session, (s) => this.turnSign(s))) : null;
    if (this.line) this.trackGroup.remove(this.line);
    const f = this.frame!;
    const n = f.pos.length;
    const pos: number[] = [];
    const col: number[] = [];
    const sAttr: number[] = [];
    const idx: number[] = [];
    // 60 cm wide and a little see-through, so it reads as rubber laid on the road, not a carpet.
    const w = 0.3;
    let j = 0;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const sv = i === n ? f.length : f.s[k];
      while (j < lap.s.length - 2 && lap.s[j + 1] < sv) j++;
      const brake = lap.brk[j] > 0;
      const thr = lap.thr[j];
      const c = brake ? RED : thr >= 95 ? PAPER : new THREE.Color("#8a8780");
      const p = f.pos[k];
      const sd = f.side[k];
      const o = this.carOffsetAt(sv); // exactly where the car drives
      pos.push(p.x + sd.x * (o + w), p.y + 0.08, p.z + sd.z * (o + w), p.x + sd.x * (o - w), p.y + 0.08, p.z + sd.z * (o - w));
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      sAttr.push(sv, sv);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("aS", new THREE.Float32BufferAttribute(sAttr, 1));
    geo.setAttribute("aKeep", new THREE.Float32BufferAttribute(new Float32Array(sAttr.length), 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uCarS: { value: 0 }, uFade: { value: 700 }, uReveal: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aS; attribute float aKeep; attribute vec3 color;
        varying float vS; varying float vKeep; varying vec3 vColor;
        void main() { vS = aS; vKeep = aKeep; vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uCarS; uniform float uFade; uniform float uReveal;
        varying float vS; varying float vKeep; varying vec3 vColor;
        void main() {
          float behind = uCarS - vS;
          if (behind < 0.0 && uReveal < 0.5) discard;
          // The line fades behind the car like a wake, except where the model took evidence.
          float wake = max(exp(-max(behind, 0.0) / uFade), 0.12);
          float a = max(max(wake, vKeep * 0.95), uReveal * 0.8);
          vec3 c = vColor * (1.0 + vKeep * 0.5) * mix(0.62, 0.55, 1.0 - wake);
          gl_FragColor = vec4(c, a * 0.82);
        }`,
    });
    this.line = new THREE.Mesh(geo, mat);
    this.line.renderOrder = 2;
    this.trackGroup.add(this.line);
    this.labels.forEach((l) => ((l.sprite.material as THREE.SpriteMaterial).opacity = 0.55));
  }

  /** Mark a corner where the model took evidence: keep its rubber, light its label. */
  markEvidence(cornerIndex: number, lo: number, hi: number, note?: string) {
    if (this.line) {
      const a = this.line.geometry.getAttribute("aKeep") as THREE.BufferAttribute;
      const s = this.line.geometry.getAttribute("aS") as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        const v = s.getX(i);
        if (v >= lo && v <= hi) a.setX(i, 1);
      }
      a.needsUpdate = true;
    }
    // A ring of light spreads from the corner the model just read.
    const at = this.pointAt((lo + hi) / 2);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.skyDark ? PAPER : INK, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.position.copy(at).setY(at.y + 0.3);
    this.trackGroup.add(ring);
    this.pulses.push({ mesh: ring, age: 0 });
    const l = this.labels[cornerIndex];
    if (l) {
      const m = l.sprite.material as THREE.SpriteMaterial;
      // State is a mark, not a hue: a read corner gains a notch and, on board, a caption.
      l.read = true;
      l.note = note;
      m.map = labelTexture(`T${l.n}`, this.labelInk, note, true);
      l.aspect = note ? 8 : 2;
      m.opacity = 1;
      m.needsUpdate = true;
    }
  }

  /** Seeking back: undo markEvidence for a corner the car has not reached again. */
  unmarkEvidence(cornerIndex: number, lo: number, hi: number) {
    if (this.line) {
      const a = this.line.geometry.getAttribute("aKeep") as THREE.BufferAttribute;
      const s = this.line.geometry.getAttribute("aS") as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        const v = s.getX(i);
        if (v >= lo && v <= hi) a.setX(i, 0);
      }
      a.needsUpdate = true;
    }
    const l = this.labels[cornerIndex];
    if (l && l.read) {
      const m = l.sprite.material as THREE.SpriteMaterial;
      l.read = false;
      l.note = undefined;
      l.aspect = 2;
      m.map?.dispose();
      m.map = labelTexture(`T${l.n}`, this.labelInk);
      m.opacity = 0.55;
      m.needsUpdate = true;
    }
  }

  revealLine(on: boolean) {
    if (this.line) this.line.material.uniforms.uReveal.value = on ? 1 : 0;
  }

  private indexAt(s: number): [number, number, number] {
    const f = this.frame!;
    const n = f.pos.length;
    const L = f.length;
    const sv = ((s % L) + L) % L;
    const step = f.s[1] - f.s[0];
    const i = Math.min(Math.floor(sv / step), n - 1);
    const j = (i + 1) % n;
    const segLen = j === 0 ? L - f.s[i] : step;
    return [i, j, Math.min((sv - f.s[i]) / segLen, 1)];
  }

  /** The frame point nearest to distance s. */
  private nearestIndex(s: number): number {
    const [i, j, u] = this.indexAt(s);
    return u < 0.5 ? i : j;
  }

  /** The centreline in scene coordinates, from the line, for the track map. */
  outline(): THREE.Vector3[] {
    return this.frame?.pos ?? [];
  }

  pointAt(s: number): THREE.Vector3 {
    const [i, j, u] = this.indexAt(s);
    return this.frame!.pos[i].clone().lerp(this.frame!.pos[j], u);
  }

  tangentAt(s: number): THREE.Vector3 {
    const [i, j, u] = this.indexAt(s);
    return this.frame!.tan[i].clone().lerp(this.frame!.tan[j], u).normalize();
  }

  /** Direction of travel from the line 8 m behind to 8 m ahead: steady on straights, still
   * turning the car through a corner. */
  headingAt(s: number): THREE.Vector3 {
    return this.pointAt(s + 8).sub(this.pointAt(s - 8)).setY(0).normalize();
  }

  /** Sideways offset of the racing line from the centre line at s. */
  private lineOffsetAt(s: number): number {
    const [i, j, u] = this.indexAt(s);
    const line = this.frame!.line;
    return line[i] + (line[j] - line[i]) * u;
  }

  /** Where the car is at distance s: on its lap's own racing line, not the centre line (see
   * lineShape). On a kerb it sits on top of it. */
  carPointAt(s: number, line = this.lapLine): THREE.Vector3 {
    const p = this.pointAt(s).addScaledVector(this.sideAt(s), this.carOffsetAt(s, line));
    p.y += KERB_HEIGHT * this.onKerb(s, line);
    return p;
  }

  /** A lap's line at distance s (the circuit's own line before a lap is set). */
  private carOffsetAt(s: number, line = this.lapLine): number {
    if (!line) return this.lineOffsetAt(s);
    const [i, j, u] = this.indexAt(s);
    return line.offset[i] + (line.offset[j] - line.offset[i]) * u;
  }

  /** How far onto a kerb the car is at s: 0 on the road, 1 with its inside wheels on top of it. */
  private onKerb(s: number, line = this.lapLine): number {
    if (!line) return 0;
    const [i, j, u] = this.indexAt(s);
    return line.lift[i] + (line.lift[j] - line.lift[i]) * u;
  }

  /** Work out a lap's line at every frame point: shaped by the lap (shapedOffset), smoothed so it
   * never steps sideways, then held on the road (or the part of a kerb the lap earned). */
  private buildLapLine(shape: LineShape): LapLine {
    const f = this.frame!;
    const n = f.pos.length;
    const raw = new Float64Array(n);
    const lo = new Float64Array(n);
    const hi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = this.shapedOffset(f.s[i], i, shape);
      raw[i] = r.o;
      lo[i] = r.lo;
      hi[i] = r.hi;
    }
    // Smooth over about 25 m, twice; then hold inside the limits and smooth lightly once more.
    const smooth = (a: Float64Array, w: number) => {
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let d = -w; d <= w; d++) sum += a[(i + d + n) % n];
        out[i] = sum / (2 * w + 1);
      }
      return out;
    };
    const clampAll = (a: Float64Array) => a.map((v, i) => THREE.MathUtils.clamp(v, lo[i], hi[i]));
    const offset = clampAll(smooth(clampAll(smooth(smooth(raw, 3), 3)), 1));
    const lift = offset.map((o, i) => {
      const half = f.edges.half[o > 0 ? 0 : 1][i];
      return THREE.MathUtils.clamp((Math.abs(o) + 0.95 - half) / 0.5, 0, 1); // inside wheels past the line
    });
    return { offset, lift };
  }

  /** Sideways offset of a lap's line at s (frame point i), before smoothing: the circuit's line,
   * moved along the track by the lap's entry, apex and exit and swung wider or tighter by its apex
   * speed; and the limits that keep it on the road except where a fuller line runs onto the inside
   * kerb. */
  private shapedOffset(s: number, i: number, shape: LineShape): { o: number; lo: number; hi: number } {
    const f = this.frame!;
    const L = f.length;
    let shift = 0;
    let grow = 0;
    let kerb = 0; // +1 / -1: the side whose kerb the line may use here
    let reach = 0; // 1 in the middle of that kerb, easing to 0 at its ends, so the line never steps
    for (const c of shape) {
      let x = s - c.s;
      if (x > L / 2) x -= L;
      else if (x < -L / 2) x += L;
      if (x < -150 || x > 150) continue;
      const g = (at: number, w: number) => Math.exp(-(((x - at) / w) ** 2));
      shift += c.entry * g(-SHAPE_ENTRY, SHAPE_SPREAD) + c.apex * g(0, SHAPE_APEX) + c.exit * g(SHAPE_ENTRY, SHAPE_SPREAD);
      grow += c.width * g(c.apex, 35);
      if (Math.abs(x) < KERB_SPAN && c.width > 0) {
        kerb = c.turn;
        reach = Math.cos((x / KERB_SPAN) * Math.PI * 0.5) ** 2;
      }
    }
    const o = this.lineOffsetAt(s - shift) * (1 + grow);
    const room = (e: 0 | 1) => {
      const half = f.edges.half[e][i];
      const sign = e === 0 ? 1 : -1;
      // Wheels on the white line; onto the inside kerb only as far as this lap's fuller line asks.
      const onto = kerb === sign && f.edges.open[e][i] ? THREE.MathUtils.clamp(grow * KERB_PER_WIDTH, 0, KERB_REACH) * reach : 0;
      return half - 1.05 + onto;
    };
    return { o, lo: -room(1), hi: room(0) };
  }

  /** The car's direction of travel along the racing line, over 8 m behind to 8 m ahead. */
  carHeadingAt(s: number, line = this.lapLine): THREE.Vector3 {
    return this.carPointAt(s + 8, line).sub(this.carPointAt(s - 8, line)).setY(0).normalize();
  }

  /** Nose-up angle of the road under a car at s, from the height 4 m behind to 4 m ahead. Without it
   * the car stays level on slopes like the drop into Interlagos T1 and looks as if it is flying. */
  pitchAt(s: number): number {
    return Math.atan2(this.pointAt(s + 4).y - this.pointAt(s - 4).y, 8);
  }

  sideAt(s: number): THREE.Vector3 {
    const t = this.tangentAt(s);
    return new THREE.Vector3(-t.z, 0, t.x);
  }

  /** +1 when the corner turns toward +side, -1 otherwise (kerbs and labels go on the inside). */
  private turnSign(s: number): number {
    const a = this.tangentAt(s - 40);
    const b = this.tangentAt(s + 40);
    const cross = a.x * b.z - a.z * b.x;
    return cross > 0 ? 1 : -1;
  }

  setCarS(s: number) {
    // Spin the wheels by the distance travelled (radius about 0.37 m).
    const ds = s - this.carS;
    if (Math.abs(ds) < 50) for (const w of this.carWheels) w.rotation.z -= ds / 0.37;
    this.carS = s;
    if (!this.frame) return;
    const p = this.carPointAt(s);
    const t = this.carHeadingAt(s);
    this.car.position.copy(p);
    this.car.rotation.y = Math.atan2(-t.z, t.x);
    this.car.rotation.z = this.pitchAt(s);
    this.car.rotation.x = this.kerbRoll(s, this.lapLine);
    if (this.line) this.line.material.uniforms.uCarS.value = s;
  }

  /** On a kerb the inside wheels ride up: the car rolls a little away from it, and shakes over the
   * kerb's ridges (one every 1.6 m). */
  private kerbRoll(s: number, line: LapLine | null): number {
    const k = this.onKerb(s, line);
    if (!k) return 0;
    const side = this.carOffsetAt(s, line) > 0 ? 1 : -1;
    const ridges = REDUCED_MOTION ? 0 : 0.006 * Math.sin((s / 1.6) * Math.PI * 2);
    return k * (side * 0.035 + ridges);
  }

  /** The duel rival's lap, so its car drives its own line. */
  setGhostLap(lap: LapData | null) {
    this.ghostLine = lap && this.session && this.frame ? this.buildLapLine(lineShape(lap, this.session, (s) => this.turnSign(s))) : null;
  }

  /** A second car for the duel replay: the driver the model picked, in soft red. */
  setGhostS(s: number | null) {
    this.ghost.visible = s !== null && !!this.frame;
    if (s === null || !this.frame) return;
    const ds = s - this.ghostS;
    if (Math.abs(ds) < 50) for (const w of this.ghostWheels) w.rotation.z -= ds / 0.37;
    this.ghostS = s;
    const line = this.ghostLine ?? this.lapLine;
    const p = this.carPointAt(s, line);
    const t = this.carHeadingAt(s, line);
    // Offset sideways so two cars on the same line never sit inside each other, toward the middle
    // of the track so the rival never leaves it at an apex.
    p.addScaledVector(this.sideAt(s), this.carOffsetAt(s, line) > 0 ? -2.4 : 2.4);
    this.ghost.position.copy(p);
    this.ghost.rotation.y = Math.atan2(-t.z, t.x);
    this.ghost.rotation.z = this.pitchAt(s);
    this.ghost.rotation.x = this.kerbRoll(s, line);
  }

  private get labelInk(): string {
    return this.skyDark ? "#f1f0ec" : "#111111";
  }

  /** Paper or ink to suit the theme, with the night sky, fog, light and ground to match. */
  setDark(dark: boolean) {
    this.dark = dark;
    this.applyPalette();
    this.refreshInk();
  }

  /** Labels and the hidden car follow the sky: light on a dark sky (dark theme or a night race). */
  private refreshInk() {
    for (const l of this.labels) {
      const m = l.sprite.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.map = labelTexture(`T${l.n}`, this.labelInk, l.note, l.read);
      m.needsUpdate = true;
    }
    if (this.liveryHidden) this.hideLivery();
  }

  /** The car while the driver is unknown: plain ink, or plain paper on the dark theme. */
  hideLivery() {
    this.setCarColours(this.skyDark ? PAPER : INK);
    this.liveryHidden = true;
  }

  /** Paint the cars: plain while the driver is hidden, team colours once they are known. */
  setCarColours(car: THREE.ColorRepresentation, ghost: THREE.ColorRepresentation = RED) {
    this.liveryHidden = false;
    this.carColours = [car, ghost];
    const paint = (g: THREE.Group, c: THREE.ColorRepresentation) =>
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m.userData.paint) {
          m.color.set(c);
          m.emissive.set(c);
        }
      });
    paint(this.car, car);
    paint(this.ghost, ghost);
  }

  showCar(on: boolean) {
    this.car.visible = on;
  }

  /** Move the camera toward the mode's target; dt in seconds. */
  /** Step quality down one level: sharpness, shadow detail and glow, then crowds and trees. */
  private lowerQuality() {
    if (this.quality >= QUALITY.length - 1) return;
    this.quality++;
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixels));
    this.resize();
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.bloom.enabled = q.bloom;
    if (!q.shadows && this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = false;
      // Materials compiled with shadows must be built again without them.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => (x.needsUpdate = true));
      });
    }
    this.showCrowds();
    console.info(`Blind Lap: quality lowered to level ${this.quality} (${q.name})`);
  }

  /** Spectators are hidden at the lowest quality (a circuit can hold 30,000 of them). */
  private showCrowds() {
    const on = QUALITY[this.quality].crowds;
    this.envGroup?.traverse((o) => {
      if (o.userData.crowd) o.visible = on;
    });
  }

  /** Draw the frame: through the effect passes, or straight to the screen at the lowest quality. */
  private draw() {
    if (QUALITY[this.quality].post) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Watch the time between frames; if the last 90 average over 33 ms (under 30 fps), lower
   * quality and watch again. Only while the page is visible and drawing. */
  private watchFrames() {
    const now = performance.now();
    const gap = now - this.lastFrame;
    this.lastFrame = now;
    if (gap <= 0 || gap > 250 || document.hidden) return; // paused, hidden or the first frame
    this.frameTimes.push(gap);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 33) this.lowerQuality();
  }

  update(dt: number, speedKmh = 0, braking = false) {
    this.watchFrames();
    if (!this.frame) {
      this.draw();
      return;
    }
    const p = this.carPointAt(this.carS);
    const t = this.carHeadingAt(this.carS);
    let want: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.mode === "chase") {
      // Look further ahead the faster the car goes, so slow hairpins keep the car in frame.
      const ahead = this.carPointAt(this.carS + 8 + speedKmh * 0.05);
      // Low and close, like a TV chase camera: speed reads from the road and barriers rushing past.
      // The distance depends on speed only and changes slowly. (It used to jump with acceleration;
      // that moved the camera up to 11 m against the car, so braking looked like a sudden stop.)
      const back = 9.5 + speedKmh * 0.012;
      // Height is taken from the higher of the car and the road under the camera, so going downhill
      // the camera stays above the road behind instead of sinking into it and looking up at the car.
      const behindY = this.pointAt(this.carS - back).y;
      want = p.clone().addScaledVector(t, -back).setY(Math.max(p.y, behindY) + 2.8 + speedKmh * 0.0015);
      // Under braking the view tips forward a little, easing in and out.
      this.dip += ((braking ? 1 : 0) - this.dip) * Math.min(dt * 1.5, 1);
      // On phones the driver grid covers the lower screen: aim lower so the car rides higher.
      const narrow = (this.canvas.clientWidth || window.innerWidth) <= 860;
      look = ahead.setY(ahead.y + 0.8 - this.dip * 0.6 - (narrow ? 4 : 0));
    } else if (this.mode === "onboard") {
      // Just above the cockpit, looking down the road: the view from the car.
      want = p.clone().addScaledVector(t, -0.4).setY(p.y + 1.5);
      const ahead = this.carPointAt(this.carS + 45);
      look = ahead.setY(ahead.y + 0.5);
    } else if (this.mode === "side") {
      // Running alongside, a little ahead, so the car crosses the frame side-on. It stays inside the
      // track edge: further out it filmed the barrier and the side of the raised track.
      const sd = this.sideAt(this.carS);
      want = p.clone().addScaledVector(sd, 5.8).addScaledVector(t, 2).setY(p.y + 1.9);
      look = p.clone().addScaledVector(t, 1).setY(p.y + 0.5);
    } else if (this.mode === "tv") {
      // A broadcast camera: high, behind and to the side, zoomed in (the narrow view is set below).
      const sd = this.sideAt(this.carS);
      want = p.clone().addScaledVector(t, -48).addScaledVector(sd, 20).setY(p.y + 24);
      look = p.clone().addScaledVector(t, 10).setY(p.y);
    } else if (this.mode === "heli") {
      if (this.ghost.visible) {
        // Duel: frame the midpoint of the two cars, low enough that both read as cars.
        const mid = p.clone().lerp(this.ghost.position, 0.5);
        want = mid.clone().addScaledVector(t, -40).add(new THREE.Vector3(0, 70, 0));
        look = mid.addScaledVector(t, 12);
      } else {
        want = p.clone().addScaledVector(t, -70).add(new THREE.Vector3(0, 125, 0));
        look = this.carPointAt(this.carS + 40);
      }
    } else {
      if (!REDUCED_MOTION) this.orbitAngle += dt * 0.05;
      const r = this.radius * 1.35;
      const a = this.orbitAngle + this.userYaw;
      want = new THREE.Vector3(Math.cos(a) * r, this.radius * 0.95 * (1 + this.userPitch * 0.6), Math.sin(a) * r);
      look = new THREE.Vector3(0, 0, 0);
    }
    if (this.mode !== "orbit" && (this.userYaw || this.userPitch)) {
      // The visitor's angle: swing the camera round the car at the same distance, and turn the
      // view toward the car the further they have dragged.
      const off = want.clone().sub(p);
      const L = off.length();
      const az = Math.atan2(off.z, off.x) + this.userYaw;
      const el = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(off.y / L, -1, 1)) + this.userPitch, 0.04, 1.45);
      want = p.clone().add(new THREE.Vector3(Math.cos(el) * Math.cos(az) * L, Math.sin(el) * L, Math.cos(el) * Math.sin(az) * L));
      const w = Math.min(1, (Math.abs(this.userYaw) + Math.abs(this.userPitch)) / 0.3);
      look = look.lerp(p.clone().setY(p.y + 0.6), w);
    }
    this.updateLabels();
    const snap = this.snap;
    this.snap = false;
    for (const p of this.pulses) {
      p.age += dt;
      const k = Math.min(p.age / 1.4, 1);
      p.mesh.scale.setScalar(4 + k * 60);
      p.mesh.material.opacity = 0.8 * (1 - k) * (1 - k);
      if (k >= 1) {
        this.trackGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    }
    this.pulses = this.pulses.filter((p) => p.age < 1.4);
    if (this.mode === "orbit") {
      const k = snap ? 1 : 1 - Math.exp(-dt * 1.2);
      this.camPos.lerp(want, k);
      this.camLook.lerp(look, k);
    } else {
      // Smooth the camera's offset from the car, not its absolute position, so it never falls
      // behind at 4x playback.
      // On board the camera is part of the car: no lag once there, or it would swing in every
      // corner. Switching to it glides in first instead of cutting, arcing up over the bodywork.
      this.blend = Math.min(1, this.blend + dt / 0.7);
      const target = want.clone().sub(p);
      // Locked only once it has arrived, so the last stretch never jumps.
      const settled = this.mode === "onboard" && this.blend >= 1 && this.offset.distanceToSquared(target) < 0.0025;
      if (this.mode === "onboard" && this.blend < 1) target.y += 1.5 * Math.sin(Math.PI * this.blend);
      const k = snap || settled ? 1 : 1 - Math.exp(-dt * (this.mode === "onboard" ? 6 : 4));
      this.offset.lerp(target, k);
      this.lookOffset.lerp(look.clone().sub(p), k);
      this.camPos.copy(p).add(this.offset);
      this.camLook.copy(p).add(this.lookOffset);
    }
    this.camera.position.copy(this.camPos);
    // (No camera shake: it read as the game glitching, and it ran on while paused.)
    const close = this.mode === "chase" || this.mode === "onboard" || this.mode === "side";
    // Lean and blur only while the car is moving, so a paused view is perfectly still.
    const moving = Math.abs(this.carS - this.lastCarS) > 0.01;
    this.lastCarS = this.carS;
    const moveSpeed = moving ? speedKmh : 0;
    this.camera.lookAt(this.camLook);
    // Lean into the corner with the cornering force (v squared times curvature), up to about
    // 4 degrees at 5 g, like a camera bolted to a car.
    if (close && !REDUCED_MOTION && this.frame) {
      const h0 = this.carHeadingAt(this.carS - 10);
      const h1 = this.carHeadingAt(this.carS + 10);
      const turn = Math.atan2(h0.x * h1.z - h0.z * h1.x, h0.dot(h1)); // radians over 20 m
      const v = moveSpeed / 3.6;
      const g = (v * v * (turn / 20)) / 9.81;
      const want = THREE.MathUtils.clamp(g * 0.014, -0.075, 0.075) * (this.mode === "side" ? 0.4 : 1);
      this.roll += (want - this.roll) * Math.min(dt * 4, 1);
      this.camera.rotateZ(this.roll);
    } else this.roll = 0;
    const blur = close && !REDUCED_MOTION && QUALITY[this.quality].bloom ? THREE.MathUtils.clamp((moveSpeed - 110) / 220, 0, 1) : 0;
    this.speedBlur.uniforms.uStrength.value += (blur - this.speedBlur.uniforms.uStrength.value) * Math.min(dt * 3, 1);
    this.updateFog(snap ? 10 : dt);
    this.updateShadow(p);
    // The view widens with speed on board, so 330 km/h feels faster than 80.
    const fast = (this.mode === "chase" || this.mode === "onboard") && !REDUCED_MOTION;
    const wantFov = this.mode === "tv" ? 30 : fast ? 56 + Math.min(speedKmh, 340) * 0.06 : 52;
    this.fov += (wantFov - this.fov) * Math.min(dt * 1.5, 1);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.draw();
  }

  /** One 4096 shadow map over a whole circuit is about 0.6 m a pixel, too coarse for a car to cast
   * a shadow, so it looked as if it floated. Close cameras get a shadow box 80 m across that
   * follows the car (2 cm a pixel); the overview cameras keep the whole circuit. */
  private updateShadow(car: THREE.Vector3) {
    const near = this.mode !== "orbit" && this.mode !== "heli";
    const r = this.radius;
    const sc = this.sun.shadow.camera;
    if (near !== this.shadowNear) {
      this.shadowNear = near;
      const half = near ? 40 : r * 1.15;
      sc.left = sc.bottom = -half;
      sc.right = sc.top = half;
      sc.near = near ? 1 : 10;
      sc.far = near ? 600 : r * 4;
      sc.updateProjectionMatrix();
    }
    const dir = SUN_DIR;
    if (near) {
      this.sun.target.position.copy(car);
      this.sun.position.copy(car).addScaledVector(dir, 300);
    } else {
      this.sun.target.position.set(0, 0, 0);
      this.sun.position.copy(dir).multiplyScalar(r * 1.1);
    }
  }

  /** On board the far side of the circuit melts into the haze; from above or in the overview the
   * whole circuit stays visible. The fog is set from how far the camera really is from what it
   * looks at, so it can never swallow the view: it used to follow the camera mode 5% per frame,
   * and for seconds after the camera flew out the scene was fog (grey, or black in the dark theme). */
  private updateFog(dt: number) {
    const fog = this.scene.fog as THREE.Fog;
    const r = this.radius;
    const d = this.camPos.distanceTo(this.camLook);
    const [near, far] =
      this.mode === "heli" ? [1400, 5000] : this.mode === "orbit" ? [Math.min(r * 0.9, 900), Math.max(r * 2.6, 2600)] : [220, 1100];
    const k = 1 - Math.exp(-dt * 4);
    fog.near += (Math.max(near, d * 0.8) - fog.near) * k;
    fog.far += (Math.max(far, d + r * 2.2) - fog.far) * k;
  }

  /** Overview shows every corner number; on board, the corners just behind and ahead of the car.
   * Evidence captions only show on board, beside the corner the car has just left. */
  private updateLabels() {
    const L = this.frame!.length;
    const overview = this.mode === "orbit";
    const size = overview ? this.radius / 34 : this.mode === "heli" ? 22 : 8;
    for (const l of this.labels) {
      const ahead = (((l.s - this.carS) % L) + L) % L;
      const behind = L - ahead;
      // From above, the corners just read trail behind the car with their captions (not in the duel,
      // where both cars cross them). On board, only the corners ahead are numbered.
      const trail = this.mode === "heli" && !this.ghost.visible && behind < 700;
      l.sprite.visible =
        this.labelsOn && (overview || ahead < (this.mode === "heli" ? 1200 : 650) || trail) && !this.underHud(l.sprite.position);
      // Captioned labels are wider; anchor them on the corner number, not the middle. Elsewhere only
      // the number shows (the left quarter of a captioned texture) so the map stays readable.
      const aspect = trail ? l.aspect : 2;
      const map = (l.sprite.material as THREE.SpriteMaterial).map;
      if (map) map.repeat.set(aspect / l.aspect, 1);
      l.sprite.scale.set(size * aspect, size, 1);
      l.sprite.center.set(1 / aspect, 0.5);
    }
  }

  /** True when a world point would draw under one of the play HUD panels (session title, tyre
   * gauge, driver grid, evidence line), so its label is better hidden than printed over text. */
  private underHud(p: THREE.Vector3): boolean {
    if (!document.body.classList.contains("playing")) return false;
    const v = p.clone().project(this.camera);
    if (v.z > 1) return true;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * h;
    if (w <= 860) return y < 250 || y > h - 320;
    return (
      (x < 560 && y < 170) || // session title
      (x < 470 && y > h - 470) || // tyre gauge
      x > w - 380 || // driver grid
      y > h - 110 // evidence line
    );
  }

  /** Start the on-board camera from where the overview camera is, then glide in. */
  snapCamera() {
    const p = this.carPointAt(this.carS);
    this.offset.copy(this.camera.position).sub(p);
    this.lookOffset.copy(this.camLook).sub(p);
  }
}
