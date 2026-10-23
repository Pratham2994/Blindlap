// The F1 car, about 5.5 m long, facing +x. A modelled car (loaded from public/models) replaces the
// built one once it arrives; the built one, from primitives, shows until then or if loading fails.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface Car {
  group: THREE.Group;
  wheels: THREE.Object3D[];
}

const MODEL_URL = `${import.meta.env.BASE_URL}models/lp830/car.gltf`;
const LENGTH = 5.5; // metres, nose to rear wing
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
