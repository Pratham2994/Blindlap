// A stylised low-poly F1 car, about 5.6 m long, facing +x. Built from primitives so it costs no
// assets: floor, tub, nose, sidepods, engine cover, halo, wings, and four wheels that spin.
import * as THREE from "three";

export interface Car {
  group: THREE.Group;
  wheels: THREE.Mesh[];
}

export function makeF1Car(colour: THREE.Color): Car {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.42, metalness: 0.1, emissive: colour, emissiveIntensity: 0.06 });
  const carbon = new THREE.MeshStandardMaterial({ color: "#141414", roughness: 0.65 });
  const rubber = new THREE.MeshStandardMaterial({ color: "#0c0c0c", roughness: 0.95 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(4.7, 0.08, 1.5), carbon, -0.2, 0.12, 0); // floor
  add(new THREE.BoxGeometry(2.3, 0.5, 0.78), paint, 0.05, 0.45, 0); // tub
  add(new THREE.CylinderGeometry(0.1, 0.3, 1.7, 10).rotateZ(-Math.PI / 2), paint, 1.95, 0.36, 0); // nose
  for (const z of [0.68, -0.68]) add(new THREE.BoxGeometry(1.5, 0.46, 0.5), paint, -0.35, 0.38, z); // sidepods
  add(new THREE.BoxGeometry(1.9, 0.5, 0.5), paint, -1.25, 0.66, 0); // engine cover
  add(new THREE.BoxGeometry(0.5, 0.42, 0.34), paint, -0.45, 1.0, 0); // airbox
  add(new THREE.BoxGeometry(0.42, 0.16, 0.42), carbon, 0.35, 0.76, 0); // cockpit opening
  const halo = add(new THREE.TorusGeometry(0.33, 0.035, 6, 18, Math.PI), carbon, 0.42, 0.78, 0);
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
