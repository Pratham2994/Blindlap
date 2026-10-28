// Turn the downloaded "( FREE ) Formula One LP-830 SDC" glTF (CC BY 4.0, SDC PERFORMANCE) into the
// game's car: geometry only. Its textures are a logo livery (Blender, Sketchfab, sponsors) and a
// branded tyre wall, so they are dropped for flat paint, carbon and rubber; the paint is recoloured
// in the game (ink while the driver is hidden, team colour at the reveal).
// Usage: node scripts/prep-car.mjs <folder with scene.gltf, scene.bin, license.txt>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const src = process.argv[2];
const out = new URL("../public/models/lp830/", import.meta.url);
mkdirSync(out, { recursive: true });
const g = JSON.parse(readFileSync(join(src, "scene.gltf"), "utf8"));

const flat = (name, rgb, metallic, roughness) => ({
  name,
  pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: metallic, roughnessFactor: roughness },
});
const byName = Object.fromEntries(g.materials.map((m, i) => [m.name, i]));
const replace = {
  "Material.001": flat("paint", [1, 1, 1], 0.25, 0.38), // the logo livery
  "Material.002": flat("carbon", [0.03, 0.03, 0.03], 0.3, 0.45), // carbon texture
  "Material.008": flat("tyre", [0.02, 0.02, 0.02], 0, 0.9), // branded tyre wall
  "Material.010": flat("carbon", [0.03, 0.03, 0.03], 0.3, 0.45), // blue accents read as a team colour
  "Material.012": flat("carbon", [0.03, 0.03, 0.03], 0.3, 0.45),
  "Material.005": flat("rim", [0.08, 0.08, 0.08], 0.7, 0.3), // red-orange rims
};
for (const [name, mat] of Object.entries(replace)) g.materials[byName[name]] = mat;
for (const m of g.materials) {
  // No material may still point at a texture once the images are gone.
  delete m.normalTexture;
  delete m.emissiveTexture;
  if (m.extensions) delete m.extensions.KHR_materials_specular?.specularColorTexture;
}
delete g.textures;
delete g.images;
delete g.samplers;

// Stable names for the two axles (three.js strips the dots from node names).
for (const n of g.nodes) {
  if (n.name === "Car.001_1") n.name = "axle_a";
  if (n.name === "Car.002_2") n.name = "axle_b";
}
// Repack the geometry at half the size: texture coordinates are no longer used (the textures are
// gone), indices fit in 16 bits, and normals keep enough precision in 8 bits a component
// (KHR_mesh_quantization, which three.js reads without any extra decoder).
const bin = readFileSync(join(src, "scene.bin"));
const view = (acc) => {
  const bv = g.bufferViews[acc.bufferView];
  const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3 }[acc.type];
  const Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[acc.componentType];
  const stride = bv.byteStride ? bv.byteStride / Type.BYTES_PER_ELEMENT : comps;
  const src = new Type(bin.buffer, bin.byteOffset + offset, (acc.count - 1) * stride + comps);
  const out = new Type(acc.count * comps);
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = src[i * stride + c];
  return out;
};
const chunks = [];
let length = 0;
const views = [];
const accessors = [];
const push = (bytes, target, stride) => {
  const pad = (4 - (length % 4)) % 4;
  if (pad) chunks.push(Buffer.alloc(pad));
  length += pad;
  views.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength, target, ...(stride ? { byteStride: stride } : {}) });
  chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  length += bytes.byteLength;
  return views.length - 1;
};
for (const mesh of g.meshes) {
  for (const prim of mesh.primitives) {
    const posAcc = g.accessors[prim.attributes.POSITION];
    const pos = view(posAcc);
    accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: posAcc.count, type: "VEC3", min: posAcc.min, max: posAcc.max });
    const posIndex = accessors.length - 1;
    const nrmAcc = g.accessors[prim.attributes.NORMAL];
    const nrm = view(nrmAcc);
    const packed = new Int8Array(nrmAcc.count * 4); // 4-byte aligned vertices
    for (let i = 0; i < nrmAcc.count; i++) for (let c = 0; c < 3; c++) packed[i * 4 + c] = Math.round(Math.max(-1, Math.min(1, nrm[i * 3 + c])) * 127);
    accessors.push({ bufferView: push(packed, 34962, 4), componentType: 5120, normalized: true, count: nrmAcc.count, type: "VEC3" });
    const nrmIndex = accessors.length - 1;
    const idxAcc = g.accessors[prim.indices];
    const idx = view(idxAcc);
    const small = posAcc.count <= 65535;
    const indices = small ? Uint16Array.from(idx) : idx;
    accessors.push({ bufferView: push(indices, 34963), componentType: small ? 5123 : 5125, count: idxAcc.count, type: "SCALAR" });
    prim.attributes = { POSITION: posIndex, NORMAL: nrmIndex };
    prim.indices = accessors.length - 1;
  }
}
g.accessors = accessors;
g.bufferViews = views;
g.buffers = [{ uri: "car.bin", byteLength: length }];
g.extensionsUsed = [...new Set([...(g.extensionsUsed ?? []), "KHR_mesh_quantization"])];
g.extensionsRequired = [...new Set([...(g.extensionsRequired ?? []), "KHR_mesh_quantization"])];
g.asset.extras = { ...(g.asset.extras ?? {}), note: "Textures removed, materials flattened and geometry repacked for Blind Lap." };

writeFileSync(new URL("car.gltf", out), JSON.stringify(g));
writeFileSync(new URL("car.bin", out), Buffer.concat(chunks));
copyFileSync(join(src, "license.txt"), new URL("LICENSE.txt", out));
console.log("wrote", out.pathname);
