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
g.buffers[0].uri = "car.bin";
g.asset.extras = { ...(g.asset.extras ?? {}), note: "Textures removed and materials flattened for Blind Lap." };

writeFileSync(new URL("car.gltf", out), JSON.stringify(g));
copyFileSync(join(src, "scene.bin"), new URL("car.bin", out));
copyFileSync(join(src, "license.txt"), new URL("LICENSE.txt", out));
console.log("wrote", out.pathname);
