// The 3D circuit: a raised asphalt strip built from the real position data, sitting on a ground
// moulded like a tyre sidewall, with the car laying a rubber line that remembers the evidence.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { LapData, Session } from "../data";
import { makeF1Car } from "./car";
import { asphaltTexture, labelTexture, sidewallTextures } from "./textures";

export const COMPOUND = {
  soft: new THREE.Color("#e8312a"),
  medium: new THREE.Color("#f5c518"),
  hard: new THREE.Color("#f2f0ea"),
  inter: new THREE.Color("#3fae49"),
  wet: new THREE.Color("#2f7fe0"),
};

// Haze colour in linear space, equal to the sky shader's horizon so ground and sky meet without a seam.
const HAZE = new THREE.Color().setRGB(0.022, 0.022, 0.023, THREE.LinearSRGBColorSpace);

const REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const ELEVATION = 2; // vertical exaggeration so hills read from the chase camera
const TRACK_WIDTH = 13;
const STRIP_DEPTH = 3; // the track is a thick strip floating over the sidewall, casting its shadow
const FLOAT = 10;

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
  private wheels: THREE.Mesh[] = [];
  private pulses: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; age: number }[] = [];
  private ghost: THREE.Group;
  private carLight: THREE.PointLight;
  private sun: THREE.DirectionalLight;
  private line: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private labels: { sprite: THREE.Sprite; n: number | string; s: number; aspect: number }[] = [];
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
    this.scene.background = new THREE.Color("#0b0b0b");
    this.scene.fog = new THREE.Fog(HAZE, 1500, 6000);
    this.scene.add(this.makeSky());

    this.scene.add(new THREE.HemisphereLight("#d8d4cc", "#050505", 0.55));
    // One low raking light, like late sun across a moulded sidewall: it makes the relief read.
    this.sun = new THREE.DirectionalLight("#fff4e6", 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.car = this.makeCar();
    this.ghost = this.makeCar(COMPOUND.soft);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.carLight = new THREE.PointLight("#fff2dc", 14, 30, 1.8);
    this.car.add(this.carLight);
    this.carLight.position.set(0, 6, 0);
    this.scene.add(this.trackGroup, this.car);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.45, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener("resize", () => this.resize());
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
  private makeSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          // Haze is a touch brighter on the side the light sits (+x), and thins quickly with height.
          float sun = max(dot(normalize(vDir.xz), normalize(vec2(0.9, 0.35))), 0.0);
          vec3 zenith = vec3(0.004, 0.004, 0.0045);
          vec3 horizon = mix(vec3(0.022, 0.022, 0.023), vec3(0.04, 0.039, 0.038), pow(sun, 8.0));
          float t = smoothstep(-0.02, 0.28, h);
          vec3 c = mix(horizon, zenith, t);
          if (h < -0.02) c = vec3(0.022, 0.022, 0.023);
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

  private makeCar(colour: THREE.Color = COMPOUND.hard): THREE.Group {
    const car = makeF1Car(colour);
    this.wheels.push(...car.wheels);
    return car.group;
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
    const tan = pos.map((_, i) => pos[(i + 1) % n].clone().sub(pos[(i - 1 + n) % n]).setY(0).normalize());
    const side = tan.map((t) => new THREE.Vector3(-t.z, 0, t.x));
    const s = pos.map((_, i) => i * step);
    this.frame = { pos, tan, side, s, length: session.length };
    this.radius = Math.max(...pos.map((p) => Math.hypot(p.x, p.z)));

    this.trackGroup.add(this.buildGround(session), this.buildStrip(), this.buildKerbs(session));
    for (const [k, c] of session.corners.entries()) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture(`T${c.n}`), transparent: true, opacity: 0.55, depthWrite: false }),
      );
      const p = this.pointAt(c.s);
      const sd = this.sideAt(c.s);
      const turn = this.turnSign(c.s);
      sprite.position.copy(p).addScaledVector(sd, -turn * 34).setY(p.y + 14);
      this.trackGroup.add(sprite);
      this.labels[k] = { sprite, n: c.n, s: c.s, aspect: 2 };
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
    this.scene.fog = new THREE.Fog(HAZE, Math.min(r * 0.9, 900), Math.max(r * 2.6, 2600));
  }

  private buildGround(session: Session): THREE.Mesh {
    const words = [
      "BLIND LAP",
      `${session.circuit.toUpperCase()} · ${session.date.slice(0, 4)}`,
      "QUALIFYING",
      `${(session.length / 1000).toFixed(3)} KM`,
      "WHO IS DRIVING",
      `${session.corners.length} CORNERS`,
    ];
    const { map, bump } = sidewallTextures(words);
    const size = this.radius * 2.9;
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(size / 2, 256),
      new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 6, roughness: 0.92, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    // Circle UVs are planar on [0,1], so the texture's rings stay concentric with the disc.
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
  private buildKerbs(session: Session): THREE.Group {
    const g = new THREE.Group();
    const mats = [
      new THREE.MeshStandardMaterial({ color: COMPOUND.hard, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: "#2a2a2a", roughness: 0.6 }),
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

  /** Paint the lap's rubber line: wet blue under braking, hard white at full throttle. */
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
      const c = brake ? COMPOUND.wet : thr >= 95 ? COMPOUND.hard : new THREE.Color("#8a8780");
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
          vec3 c = vColor * (1.0 + vKeep * 0.5) * mix(0.85, 0.75, 1.0 - wake);
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
      new THREE.MeshBasicMaterial({ color: COMPOUND.hard, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.position.copy(at).setY(at.y + 0.3);
    this.trackGroup.add(ring);
    this.pulses.push({ mesh: ring, age: 0 });
    const l = this.labels[cornerIndex];
    if (l) {
      const m = l.sprite.material as THREE.SpriteMaterial;
      // State is a mark, not a hue: a read corner gains a notch and, on board, a caption.
      m.map = labelTexture(`T${l.n}`, "#f2f0ea", note, true);
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
    if (Math.abs(ds) < 50) for (const w of this.wheels.slice(0, 4)) w.rotation.z -= ds / 0.37;
    this.carS = s;
    if (!this.frame) return;
    const p = this.pointAt(s);
    const t = this.tangentAt(s);
    this.car.position.copy(p);
    this.car.rotation.y = Math.atan2(-t.z, t.x);
    if (this.line) this.line.material.uniforms.uCarS.value = s;
  }

  /** A second car for the duel replay: the driver the model picked, in soft red. */
  setGhostS(s: number | null) {
    this.ghost.visible = s !== null && !!this.frame;
    if (s === null || !this.frame) return;
    const ds = s - this.ghostS;
    if (Math.abs(ds) < 50) for (const w of this.wheels.slice(4)) w.rotation.z -= ds / 0.37;
    this.ghostS = s;
    const p = this.pointAt(s);
    const t = this.tangentAt(s);
    // Offset sideways a little so two cars on the same line never sit inside each other.
    this.ghost.position.copy(p).addScaledVector(this.sideAt(s), 2.2);
    this.ghost.rotation.y = Math.atan2(-t.z, t.x);
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
    const t = this.tangentAt(this.carS);
    let want: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.mode === "chase") {
      const ahead = this.pointAt(this.carS + 32);
      const back = 13 + speedKmh * 0.02;
      want = p.clone().addScaledVector(t, -back).setY(p.y + 4.2 + speedKmh * 0.006);
      // Under braking the nose dips and the view tips forward a little.
      this.dip += ((braking ? 1 : 0) - this.dip) * Math.min(dt * 6, 1);
      // On phones the driver grid covers the lower screen: aim lower so the car rides higher.
      const narrow = (this.canvas.clientWidth || window.innerWidth) <= 860;
      look = ahead.setY(ahead.y + 1 - this.dip * 2 - (narrow ? 9 : 0));
    } else if (this.mode === "heli") {
      want = p.clone().addScaledVector(t, -70).add(new THREE.Vector3(0, 125, 0));
      look = this.pointAt(this.carS + 40);
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
    const wantFov = this.mode === "chase" && !REDUCED_MOTION ? 52 + Math.min(speedKmh, 340) * 0.03 : 52;
    this.fov += (wantFov - this.fov) * Math.min(dt * 3, 1);
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
    if (w <= 860) return y < 200 || y > h - 320;
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
