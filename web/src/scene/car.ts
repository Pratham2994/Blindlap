// The F1 car, about 5.5 m long, facing +x. A modelled car (loaded from public/models) replaces the
// built one once it arrives; the built one, from primitives, shows until then or if loading fails.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface Car {
  group: THREE.Group;
  wheels: THREE.Object3D[];
}

/** The driver in the cockpit, facing +x and centred on the helmet: a full-face helmet with a dark
 * visor slot, shoulders inside the cockpit, arms reaching forward and gloves on the steering
 * wheel. Plain grey, since a real helmet design would give the driver away. */
export function driverFigure(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: "#d9d7d2", roughness: 0.3, metalness: 0.1 });
  const visor = new THREE.MeshStandardMaterial({ color: "#050505", roughness: 0.05, metalness: 0.7 });
  const suit = new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.85 });
  const glove = new THREE.MeshStandardMaterial({ color: "#1a1a1a", roughness: 0.7 });
  const carbon = new THREE.MeshStandardMaterial({ color: "#111111", roughness: 0.4, metalness: 0.3 });
  const add = (m: THREE.Mesh) => {
    m.castShadow = true;
    g.add(m);
    return m;
  };

  // Helmet: longer front to back than across, like a real one. Sphere angles put the front at +x.
  const scale = new THREE.Vector3(1.15, 1, 0.95);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 18), shell)).scale.copy(scale);
  // A thin stripe over the top, front to back: the same for every driver, so it gives none away.
  // It starts just above the visor (0.6 rad up from the front) and runs over to the back.
  const stripe = add(new THREE.Mesh(new THREE.TorusGeometry(0.136, 0.011, 6, 28, Math.PI - 0.6), new THREE.MeshStandardMaterial({ color: "#e10600", roughness: 0.4 })));
  stripe.rotation.z = 0.6;
  stripe.scale.copy(scale);
  // Visor slot across the front at eye level; the shell below it is the chin bar.
  add(new THREE.Mesh(new THREE.SphereGeometry(0.137, 28, 6, (2 * Math.PI) / 3, (2 * Math.PI) / 3, Math.PI * 0.4, Math.PI * 0.14), visor)).scale.copy(scale);

  // Shoulders, low and narrow enough to stay inside the cockpit.
  add(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.2, 4, 12).rotateX(Math.PI / 2), suit)).position.set(-0.06, -0.25, 0);

  // Steering wheel ahead of the driver, top tilted back toward them, with a grip each side.
  const wheel = new THREE.Group();
  wheel.position.set(0.42, -0.2, 0);
  wheel.rotation.z = 0.35;
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.13, 0.26), carbon);
  face.castShadow = true;
  wheel.add(face);
  for (const z of [-0.14, 0.14]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 10), carbon);
    grip.position.z = z;
    grip.castShadow = true;
    wheel.add(grip);
  }
  g.add(wheel);

  // Arms from the shoulders to gloves on the grips.
  const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const m = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, a.distanceTo(b), 10), suit));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  };
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Vector3(-0.04, -0.25, side * 0.17);
    const elbow = new THREE.Vector3(0.2, -0.3, side * 0.2);
    const hand = new THREE.Vector3(0.4, -0.2, side * 0.14);
    limb(shoulder, elbow, 0.045);
    limb(elbow, hand, 0.04);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), glove)).position.copy(hand);
  }
  return g;
}

let shadowTexture: THREE.CanvasTexture | null = null;

/** A soft dark patch under the car, where the floor nearly touches the road. Broadcast footage
 * always shows one, and without it the car reads as floating above the asphalt. */
export function contactShadow(): THREE.Mesh {
  if (!shadowTexture) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.translate(128, 64);
    g.scale(1, 0.5);
    const grad = g.createRadialGradient(0, 0, 10, 0, 0, 124);
    grad.addColorStop(0, "rgba(0,0,0,0.85)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.5)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(-128, -128, 256, 256);
    shadowTexture = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 2.8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.75 }),
  );
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}

const MODEL_URL =`${import.meta.env.BASE_URL}models/lp830/car.gltf`;
const LENGTH = 5.5; // metres, nose to rear wing
// Where the helmet sits in the fitted car (x forward from the middle, y up from the road),
// placed by eye from close-ups.
const DRIVER_AT: [number, number] = [0.28, 0.85];
let model: Promise<THREE.Group> | null = null;

/** The modelled car: "( FREE ) Formula One LP-830 SDC" by SDC PERFORMANCE, CC BY 4.0 (see
 * public/models/lp830/LICENSE.txt), geometry only. Loaded once and shared by both cars. */
export function loadF1Model(): Promise<THREE.Group> {
  model ??= new GLTFLoader().loadAsync(MODEL_URL).then((g) => g.scene);
  return model;
}

/** A copy of the modelled car fitted to the built car's frame: facing +x, wheels on y = 0, centred,
 * with its own paint, and one pivot per axle that spins about z like the built car's wheels. */
export function fitF1Model(source: THREE.Group, colour: THREE.Color): Car {
  const g = new THREE.Group();
  const m = source.clone(true);
  m.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat.name === "paint") {
      const paint = mat.clone();
      paint.color.copy(colour);
      paint.emissive.copy(colour);
      paint.emissiveIntensity = 0.06;
      paint.userData.paint = true; // recoloured at the reveal
      mesh.material = paint;
    }
  });
  // The model's nose points along +z; turn it to +x.
  m.rotation.y = Math.PI / 2;
  g.add(m);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  m.scale.setScalar(LENGTH / (box.max.x - box.min.x));
  g.updateMatrixWorld(true);
  box.setFromObject(m);
  m.position.set(-(box.max.x + box.min.x) / 2, -box.min.y, -(box.max.z + box.min.z) / 2);
  g.updateMatrixWorld(true);
  const driver = driverFigure();
  driver.position.set(DRIVER_AT[0], DRIVER_AT[1], 0);
  g.add(driver);
  const wheels: THREE.Object3D[] = [];
  for (const name of ["axle_a", "axle_b"]) {
    const node = m.getObjectByName(name);
    if (!node) continue;
    const pivot = new THREE.Group();
    new THREE.Box3().setFromObject(node).getCenter(pivot.position);
    g.add(pivot);
    g.updateMatrixWorld(true);
    pivot.attach(node);
    wheels.push(pivot);
  }
  return { group: g, wheels };
}

export function makeF1Car(colour: THREE.Color): Car {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.42, metalness: 0.1, emissive: colour, emissiveIntensity: 0.06 });
  paint.userData.paint = true; // recoloured at the reveal
  const carbon = new THREE.MeshStandardMaterial({ color: "#141414", roughness: 0.65 });
  const rubber = new THREE.MeshStandardMaterial({ color: "#0c0c0c", roughness: 0.95 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  const floor = add(new THREE.BoxGeometry(4.7, 0.06, 1.5), carbon, -0.2, 0.12, 0);
  floor.castShadow = false; // a solid slab shadow reads as a block, not a car

  // Body: one extruded side profile, nose tip to gearbox, with the airbox hump behind the driver.
  const profile = new THREE.Shape();
  [
    [2.75, 0.2], [2.1, 0.3], [1.2, 0.48], [0.75, 0.6], [0.25, 0.62], [0.0, 0.78],
    [-0.25, 1.12], [-0.7, 1.1], [-1.2, 0.84], [-2.05, 0.56], [-2.25, 0.36], [-2.25, 0.16], [2.75, 0.16],
  ].forEach(([x, y], i) => (i ? profile.lineTo(x, y) : profile.moveTo(x, y)));
  const body = new THREE.ExtrudeGeometry(profile, { depth: 0.62, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
  body.translate(0, 0, -0.31);
  const shell = add(body, paint, 0, 0, 0);
  (shell.material as THREE.MeshStandardMaterial).flatShading = true;

  // Sidepods: low wedges that rise toward the cockpit and taper into the floor at the back.
  const pod = new THREE.Shape();
  [[0.75, 0.2], [0.65, 0.55], [0.1, 0.6], [-1.3, 0.38], [-1.6, 0.2]].forEach(([x, y], i) => (i ? pod.lineTo(x, y) : pod.moveTo(x, y)));
  for (const z of [0.38, -0.88]) {
    const geo = new THREE.ExtrudeGeometry(pod, { depth: 0.5, bevelEnabled: false });
    geo.translate(0, 0, z);
    add(geo, paint, 0, 0, 0);
  }
  add(new THREE.BoxGeometry(0.42, 0.12, 0.4), carbon, 0.42, 0.66, 0); // cockpit opening
  const halo = add(new THREE.TorusGeometry(0.33, 0.035, 6, 18, Math.PI), carbon, 0.42, 0.8, 0);
  halo.rotation.set(Math.PI / 2, 0, Math.PI / 2);

  add(new THREE.BoxGeometry(0.55, 0.05, 1.95), carbon, 2.65, 0.14, 0); // front wing
  for (const z of [0.97, -0.97]) add(new THREE.BoxGeometry(0.6, 0.26, 0.03), carbon, 2.62, 0.24, z);
  add(new THREE.BoxGeometry(0.42, 0.06, 1.1), paint, -2.45, 1.0, 0); // rear wing
  add(new THREE.BoxGeometry(0.3, 0.05, 1.1), carbon, -2.4, 0.86, 0);
  for (const z of [0.56, -0.56]) add(new THREE.BoxGeometry(0.62, 0.62, 0.03), carbon, -2.45, 0.78, z);
  add(new THREE.BoxGeometry(0.12, 0.5, 0.06), carbon, -2.3, 0.62, 0); // pylon

  const wheels: THREE.Mesh[] = [];
  const front = new THREE.CylinderGeometry(0.36, 0.36, 0.36, 22).rotateX(Math.PI / 2);
  const rear = new THREE.CylinderGeometry(0.37, 0.37, 0.44, 22).rotateX(Math.PI / 2);
  for (const [x, z, geo] of [
    [1.72, 0.82, front],
    [1.72, -0.82, front],
    [-1.62, 0.84, rear],
    [-1.62, -0.84, rear],
  ] as [number, number, THREE.BufferGeometry][]) {
    const w = add(geo, rubber, x, 0.37, z);
    // A painted band on the sidewall, like the compound marking, so the spin is visible.
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.025, 4, 22),
      new THREE.MeshBasicMaterial({ color: colour }),
    );
    band.position.z = z > 0 ? 0.19 : -0.19;
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: "#f2f0ea" }));
    notch.position.set(0, 0.27, band.position.z);
    w.add(band, notch);
    wheels.push(w);
  }
  return { group: g, wheels };
}
