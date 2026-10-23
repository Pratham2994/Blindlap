// The 3D circuit: a raised asphalt strip built from the real position data, sitting on a ground
// moulded like a tyre sidewall, with the car laying a rubber line that remembers the evidence.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { LapData, Session } from "../data";
import { fitF1Model, loadF1Model, makeF1Car } from "./car";
import { asphaltTexture, boardTexture, labelTexture, posterGround } from "./textures";

// The poster palette in the scene: ink, paper, F1 red.
export const INK = new THREE.Color("#141414");
const PAPER = new THREE.Color("#f3f2ee");
const RED = new THREE.Color("#e10600");

// Haze colour in linear space, equal to the sky shader's horizon so ground and sky meet without a seam.
const HAZE = new THREE.Color().setRGB(0.62, 0.61, 0.58, THREE.LinearSRGBColorSpace);
// Dark mode: the same scene at night-print values. Sky and fog meet at the horizon colour.
const NIGHT = {
  background: new THREE.Color("#141413"),
  haze: new THREE.Color().setRGB(0.012, 0.012, 0.011, THREE.LinearSRGBColorSpace),
  zenith: new THREE.Vector3(0.006, 0.006, 0.006),
  horizon: new THREE.Vector3(0.012, 0.012, 0.011),
};
const DAY = {
  background: new THREE.Color("#dcdad4"),
  haze: HAZE,
  zenith: new THREE.Vector3(0.78, 0.78, 0.76),
  horizon: new THREE.Vector3(0.62, 0.61, 0.58),
};

const REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const BARRIER_LIGHT = "#f3f2ee";
const BARRIER_DARK = "#e10600";

const ELEVATION = 1.25; // slight vertical exaggeration so hills read; at 2x slopes looked like ramps
const TRACK_WIDTH = 13;
const STRIP_DEPTH = 3; // the track is a thick strip floating over the sidewall, casting its shadow
const FLOAT = 10;
const CLEARANCE = 13; // where the track crosses itself (Suzuka), the upper road clears the lower by this much
const RAMP = 260; // metres either side of a crossing over which the upper road is lifted

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

type CameraMode = "chase" | "heli" | "orbit";

interface TrackFrame {
  pos: THREE.Vector3[];
  tan: THREE.Vector3[];
  side: THREE.Vector3[];
  s: number[];
  length: number;
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
  private ghostWheels: THREE.Object3D[] = [];
  private carColours: [THREE.ColorRepresentation, THREE.ColorRepresentation] = [INK, RED];
  private pulses: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; age: number }[] = [];
  private ghost: THREE.Group;
  private carLight: THREE.PointLight;
  private sun: THREE.DirectionalLight;
  private line: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private labels: { sprite: THREE.Sprite; n: number | string; s: number; aspect: number; read: boolean; note?: string }[] = [];
  private dark = false;
  private hemi!: THREE.HemisphereLight;
  private sky!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private groundMat: THREE.MeshStandardMaterial | null = null;
  private groundText: [string, string] = ["", ""];
  private liveryHidden = true;
  private radius = 1000;
  private camPos = new THREE.Vector3(0, 800, 800);
  private camLook = new THREE.Vector3();
  private offset = new THREE.Vector3(0, 400, 400);
  private lookOffset = new THREE.Vector3();
  private orbitAngle = 0;
  mode: CameraMode = "orbit";
  labelsOn = true;
  private shift = 0;
  private dip = 0;
  private ghostS = 0;
  private fov = 52;
  carS = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
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
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    const built = makeF1Car(INK);
    const builtGhost = makeF1Car(RED);
    this.car = new THREE.Group().add(built.group);
    this.ghost = new THREE.Group().add(builtGhost.group);
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
    this.composer.addPass(new OutputPass());
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
      uniforms: { uZenith: { value: DAY.zenith.clone() }, uHorizon: { value: DAY.horizon.clone() } },
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
        void main() {
          float h = vDir.y;
          // Haze is a touch brighter on the side the light sits (+x), and thins quickly with height.
          float sun = max(dot(normalize(vDir.xz), normalize(vec2(0.9, 0.35))), 0.0);
          vec3 horizon = mix(uHorizon, uHorizon * 1.12, pow(sun, 8.0));
          float t = smoothstep(-0.02, 0.28, h);
          vec3 c = mix(horizon, uZenith, t);
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
  setSession(session: Session) {
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
    raiseCrossings(pos, step);
    // Headings over ±12 m, so the car and camera never twitch on a straight.
    const tan = pos.map((_, i) => pos[(i + 3) % n].clone().sub(pos[(i - 3 + n) % n]).setY(0).normalize());
    const side = tan.map((t) => new THREE.Vector3(-t.z, 0, t.x));
    const s = pos.map((_, i) => i * step);
    this.frame = { pos, tan, side, s, length: session.length };
    this.radius = Math.max(...pos.map((p) => Math.hypot(p.x, p.z)));

    this.trackGroup.add(
      this.buildGround(session),
      this.buildStrip(),
      this.buildKerbs(session),
      this.buildBarriers(),
      this.buildBrakeBoards(session),
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
    this.sun.position.set(r * 0.9, r * 0.55, r * 0.35);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -r * 1.15;
    sc.right = sc.top = r * 1.15;
    sc.near = 10;
    sc.far = r * 4;
    sc.updateProjectionMatrix();
    // Close enough that the far side of the circuit melts into the haze from the chase camera.
    this.scene.fog = new THREE.Fog((this.dark ? NIGHT : DAY).haze, Math.min(r * 0.9, 900), Math.max(r * 2.6, 2600));
  }

  private buildGround(session: Session): THREE.Mesh {
    const size = this.radius * 2.9;
    this.groundText = [session.circuit, session.date.slice(0, 4)];
    this.groundMat = new THREE.MeshStandardMaterial({ map: posterGround(...this.groundText, this.dark), roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    return ground;
  }

  /** Raised asphalt strip with rubber sides, following the real elevation. */
  private buildStrip(): THREE.Group {
    const f = this.frame!;
    const n = f.pos.length;
    const top: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const half = TRACK_WIDTH / 2;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const p = f.pos[k];
      const sd = f.side[k];
      const sv = i === n ? f.length : f.s[k];
      top.push(p.x + sd.x * half, p.y, p.z + sd.z * half, p.x - sd.x * half, p.y, p.z - sd.z * half);
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
        const ex = p.x + sd.x * half * sign;
        const ez = p.z + sd.z * half * sign;
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
      new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.7, side: THREE.DoubleSide }),
    );
    walls.castShadow = true;

    // Painted white edge lines.
    const edges = new THREE.Group();
    for (const sign of [1, -1]) {
      const pts = [...f.pos, f.pos[0]].map((p, i) => {
        const sd = f.side[i % n];
        return new THREE.Vector3(p.x + sd.x * (half - 0.6) * sign, p.y + 0.05, p.z + sd.z * (half - 0.6) * sign);
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
      for (const sign of [1, -1]) {
        const at = p.clone().addScaledVector(this.sideAt(s), sign * (TRACK_WIDTH / 2 + 3.2)).setY(p.y + 0.45);
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
    const rails: THREE.Vector3[][] = [[], []];
    for (let k = 0; k < postCount; k++) {
      const s = k * postSpacing;
      const p = this.pointAt(s);
      const sd = this.sideAt(s);
      [1, -1].forEach((sign, r) => {
        const at = p.clone().addScaledVector(sd, sign * offset);
        m.makeTranslation(at.x, p.y + 2, at.z);
        posts.setMatrixAt(np++, m);
        rails[r].push(at.setY(p.y + 4));
      });
    }
    g.add(posts);
    for (const pts of rails) {
      pts.push(pts[0]);
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#6b6a66" })));
    }
    return g;
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
    const box = new THREE.BoxGeometry(3.2, 0.35, 1.6);
    for (const c of session.corners) {
      const turn = this.turnSign(c.s);
      let k = 0;
      for (let s = c.s - 28; s <= c.s + 28; s += 3.2, k++) {
        const p = this.pointAt(s);
        const t = this.tangentAt(s);
        const sd = this.sideAt(s);
        const m = new THREE.Mesh(box, mats[k % 2]);
        m.position.copy(p).addScaledVector(sd, turn * (TRACK_WIDTH / 2 + 0.6)).setY(p.y + 0.1);
        m.rotation.y = Math.atan2(-t.z, t.x);
        m.receiveShadow = true;
        g.add(m);
      }
    }
    return g;
  }

  /** Paint the lap's rubber line: red under braking, paper white at full throttle. */
  setLap(lap: LapData) {
    if (this.line) this.trackGroup.remove(this.line);
    const f = this.frame!;
    const n = f.pos.length;
    const pos: number[] = [];
    const col: number[] = [];
    const sAttr: number[] = [];
    const idx: number[] = [];
    const w = 0.4;
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
      pos.push(p.x + sd.x * w, p.y + 0.08, p.z + sd.z * w, p.x - sd.x * w, p.y + 0.08, p.z - sd.z * w);
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
          gl_FragColor = vec4(c, a);
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
      new THREE.MeshBasicMaterial({ color: this.dark ? PAPER : INK, transparent: true, opacity: 0.8, depthWrite: false }),
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
    const p = this.pointAt(s);
    const t = this.headingAt(s);
    this.car.position.copy(p);
    this.car.rotation.y = Math.atan2(-t.z, t.x);
    this.car.rotation.z = this.pitchAt(s);
    if (this.line) this.line.material.uniforms.uCarS.value = s;
  }

  /** A second car for the duel replay: the driver the model picked, in soft red. */
  setGhostS(s: number | null) {
    this.ghost.visible = s !== null && !!this.frame;
    if (s === null || !this.frame) return;
    const ds = s - this.ghostS;
    if (Math.abs(ds) < 50) for (const w of this.ghostWheels) w.rotation.z -= ds / 0.37;
    this.ghostS = s;
    const p = this.pointAt(s);
    const t = this.headingAt(s);
    // Offset sideways a little so two cars on the same line never sit inside each other.
    this.ghost.position.copy(p).addScaledVector(this.sideAt(s), 2.2);
    this.ghost.rotation.y = Math.atan2(-t.z, t.x);
    this.ghost.rotation.z = this.pitchAt(s);
  }

  private get labelInk(): string {
    return this.dark ? "#f1f0ec" : "#111111";
  }

  /** Paper or ink to suit the theme, with the night sky, fog, light and ground to match. */
  setDark(dark: boolean) {
    this.dark = dark;
    const p = dark ? NIGHT : DAY;
    this.scene.background = p.background;
    (this.scene.fog as THREE.Fog).color.copy(p.haze);
    this.sky.material.uniforms.uZenith.value.copy(p.zenith);
    this.sky.material.uniforms.uHorizon.value.copy(p.horizon);
    this.hemi.intensity = dark ? 0.9 : 1.4;
    this.hemi.groundColor.set(dark ? "#2a2926" : "#8c8a84");
    if (this.groundMat) {
      this.groundMat.map?.dispose();
      this.groundMat.map = posterGround(...this.groundText, dark);
      this.groundMat.needsUpdate = true;
    }
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
    this.setCarColours(this.dark ? PAPER : INK);
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
  update(dt: number, speedKmh = 0, braking = false) {
    if (!this.frame) {
      this.composer.render();
      return;
    }
    const p = this.pointAt(this.carS);
    const t = this.headingAt(this.carS);
    let want: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.mode === "chase") {
      // Look further ahead the faster the car goes, so slow hairpins keep the car in frame.
      const ahead = this.pointAt(this.carS + 8 + speedKmh * 0.05);
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
    } else if (this.mode === "heli") {
      if (this.ghost.visible) {
        // Duel: frame the midpoint of the two cars, low enough that both read as cars.
        const mid = p.clone().lerp(this.ghost.position, 0.5);
        want = mid.clone().addScaledVector(t, -40).add(new THREE.Vector3(0, 70, 0));
        look = mid.addScaledVector(t, 12);
      } else {
        want = p.clone().addScaledVector(t, -70).add(new THREE.Vector3(0, 125, 0));
        look = this.pointAt(this.carS + 40);
      }
    } else {
      if (!REDUCED_MOTION) this.orbitAngle += dt * 0.05;
      const r = this.radius * 1.35;
      want = new THREE.Vector3(Math.cos(this.orbitAngle) * r, this.radius * 0.95, Math.sin(this.orbitAngle) * r);
      look = new THREE.Vector3(0, 0, 0);
    }
    this.updateLabels();
    this.updateFog();
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
      const k = 1 - Math.exp(-dt * 1.2);
      this.camPos.lerp(want, k);
      this.camLook.lerp(look, k);
    } else {
      // Smooth the camera's offset from the car, not its absolute position, so it never falls
      // behind at 4x playback.
      const k = 1 - Math.exp(-dt * 4);
      this.offset.lerp(want.clone().sub(p), k);
      this.lookOffset.lerp(look.clone().sub(p), k);
      this.camPos.copy(p).add(this.offset);
      this.camLook.copy(p).add(this.lookOffset);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // The view widens with speed on board, so 330 km/h feels faster than 80.
    const wantFov = this.mode === "chase" && !REDUCED_MOTION ? 56 + Math.min(speedKmh, 340) * 0.06 : 52;
    this.fov += (wantFov - this.fov) * Math.min(dt * 1.5, 1);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.composer.render();
  }

  /** On board the far side of the circuit melts into the haze; from above or in the overview the
   * whole sidewall ground stays visible. */
  private updateFog() {
    const fog = this.scene.fog as THREE.Fog;
    const r = this.radius;
    const [near, far] =
      this.mode === "chase" ? [220, 1100] : this.mode === "heli" ? [1400, 5000] : [Math.min(r * 0.9, 900), Math.max(r * 2.6, 2600)];
    fog.near += (near - fog.near) * 0.05;
    fog.far += (far - fog.far) * 0.05;
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
    const p = this.pointAt(this.carS);
    this.offset.copy(this.camera.position).sub(p);
    this.lookOffset.copy(this.camLook).sub(p);
  }
}
