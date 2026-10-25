import * as THREE from "three";

/** Fine asphalt grain, tiled along the track. */
export function asphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6c6c6c";
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 90 + Math.random() * 70 + (Math.random() < 0.04 ? 60 : 0);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Real areas to paint into the ground, as polygons in texture pixels: [outer ring, holes...],
 * each ring x0, y0, x1, y1... (from OpenStreetMap, see scene/environment.ts). */
export interface GroundAreas {
  water: number[][][];
  wood: number[][][];
  grass: number[][][];
  gravel: number[][][];
  tarmac: number[][][];
  // The base verge along the whole track (grass at a permanent circuit, pavement in the street),
  // drawn first so the real mapped surfaces sit on top: the track line and its full width, in px.
  verge: { line: number[]; width: number; street: boolean };
}

/**
 * The ground is a sheet of poster paper: a fine survey grid and the circuit's name printed huge
 * across it, the way a race poster sets the venue. Where the real map is known, its water, woods
 * and parks are printed on it too, in their natural colours.
 */
export function posterGround(name: string, year: string, dark = false, areas?: GroundAreas): THREE.CanvasTexture {
  const size = 4096;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = dark ? "#181817" : "#dcdad4";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = dark ? "#232321" : "#cfccc5";
  g.lineWidth = 3;
  for (let x = 0; x <= size; x += 128) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, x);
    g.lineTo(size, x);
    g.stroke();
  }
  if (areas) {
    const fill = (polys: number[][][], colour: string) => {
      g.fillStyle = colour;
      for (const rings of polys) {
        g.beginPath();
        for (const r of rings) {
          g.moveTo(r[0], r[1]);
          for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1]);
          g.closePath();
        }
        g.fill("evenodd"); // holes (islands, courtyards) stay ground
      }
    };
    const v = areas.verge;
    if (v.line.length > 4) {
      g.strokeStyle = v.street ? (dark ? "#2b2a28" : "#b9b6af") : dark ? "#1f2a1c" : "#9cc07a";
      g.lineWidth = v.width;
      g.lineJoin = g.lineCap = "round";
      g.beginPath();
      g.moveTo(v.line[0], v.line[1]);
      for (let i = 2; i < v.line.length; i += 2) g.lineTo(v.line[i], v.line[i + 1]);
      g.closePath();
      g.stroke();
    }
    fill(areas.grass, dark ? "#1f2a1c" : "#a9c98a");
    fill(areas.wood, dark ? "#182515" : "#7fa865");
    fill(areas.water, dark ? "#0f2233" : "#6fa8c7");
    fill(areas.tarmac, dark ? "#242424" : "#7c7b78");
    fill(areas.gravel, dark ? "#3a3528" : "#d9c89c");
  }
  // The venue, printed across the sheet (over the map, faintly, so both read).
  g.globalAlpha = areas ? 0.55 : 1;
  g.fillStyle = dark ? "#262523" : "#c9c6be";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const label = name.toUpperCase();
  let px = 900;
  const font = (w: number, size: number) => `${w} ${size}px "Archivo Variable", sans-serif`;
  g.font = font(900, px);
  (g as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
  while (g.measureText(label).width > size * 0.92 && px > 200) {
    px -= 40;
    g.font = font(900, px);
  }
  g.fillText(label, size / 2, size / 2);
  g.font = font(800, Math.round(px * 0.28));
  g.fillText(`${year} QUALIFYING · WHO IS DRIVING?`, size / 2, size / 2 + px * 0.68);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A text sprite for corner numbers. */
export function labelTexture(text: string, colour = "#111111", note?: string, marked = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = note ? 1024 : 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.font = `800 88px "Archivo Variable", sans-serif`;
  (g as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = colour;
  g.fillText(text, 128, 68);
  if (marked) {
    // The notch: a small cut under the number, like a mark on a sidewall.
    g.beginPath();
    g.moveTo(108, 116);
    g.lineTo(148, 116);
    g.lineTo(128, 100);
    g.closePath();
    g.fill();
  }
  if (note) {
    // The corner's evidence, set beside the number like a caption.
    g.textAlign = "left";
    g.font = `700 50px "Archivo Variable", sans-serif`;
    g.fillStyle = colour;
    g.fillText(note.toUpperCase(), 262, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A trackside distance board: black numerals on white, like the real 150/100/50 boards. */
export function boardTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 168;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f4f4f2";
  g.fillRect(0, 0, 256, 168);
  g.lineWidth = 10;
  g.strokeStyle = "#111";
  g.strokeRect(5, 5, 246, 158);
  g.fillStyle = "#111";
  g.font = `900 104px "Archivo Variable", sans-serif`;
  (g as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
