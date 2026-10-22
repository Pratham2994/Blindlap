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

/**
 * The ground is a tyre sidewall seen from above: concentric moulding grooves and raised lettering
 * on a ring. Returned as a colour map and a bump map so the raking light picks out the relief.
 */
export function sidewallTextures(lettering: string[]): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const size = 4096;
  const make = () => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c;
  };
  const bumpCanvas = make();
  const g = bumpCanvas.getContext("2d")!;
  const cx = size / 2;
  g.fillStyle = "#000";
  g.fillRect(0, 0, size, size);

  // Moulding grooves: bands of fine rings, varied spacing like a real sidewall.
  const bands: [number, number, number][] = [
    [0.9, 0.985, 7],
    [0.62, 0.7, 5],
    [0.44, 0.47, 4],
  ];
  g.strokeStyle = "#5a5a5a";
  for (const [a, b, step] of bands) {
    g.lineWidth = 2;
    for (let r = a * cx; r < b * cx; r += step) {
      g.beginPath();
      g.arc(cx, cx, r, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // Two raised rims.
  g.lineWidth = 18;
  g.strokeStyle = "#9a9a9a";
  for (const r of [0.72, 0.885]) {
    g.beginPath();
    g.arc(cx, cx, r * cx, 0, Math.PI * 2);
    g.stroke();
  }

  // Raised lettering around the ring, like the brand moulded into a tyre.
  g.fillStyle = "#ffffff";
  g.textBaseline = "middle";
  g.textAlign = "center";
  const radius = 0.805 * cx;
  const items = lettering;
  const per = (Math.PI * 2) / items.length;
  items.forEach((word, k) => {
    const fontPx = k % 2 === 0 ? 150 : 70;
    g.font = `800 ${fontPx}px "Archivo Variable", sans-serif`;
    (g as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
    // Spread characters along the arc.
    const chars = [...word];
    const widths = chars.map((ch) => g.measureText(ch).width + fontPx * 0.12);
    const total = widths.reduce((a, w) => a + w, 0);
    let ang = per * k - total / radius / 2;
    for (let i = 0; i < chars.length; i++) {
      const a = ang + widths[i] / radius / 2;
      g.save();
      g.translate(cx + Math.cos(a) * radius, cx + Math.sin(a) * radius);
      g.rotate(a + Math.PI / 2);
      g.fillText(chars[i], 0, 0);
      g.restore();
      ang += widths[i] / radius;
    }
  });

  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.anisotropy = 8;

  // Colour map: rubber black that lifts slightly on the raised parts.
  const mapCanvas = make();
  const m = mapCanvas.getContext("2d")!;
  m.fillStyle = "#0e0e0e";
  m.fillRect(0, 0, size, size);
  m.globalAlpha = 0.16;
  m.drawImage(bumpCanvas, 0, 0);
  const map = new THREE.CanvasTexture(mapCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { map, bump };
}

/** A text sprite for corner numbers. */
export function labelTexture(text: string, colour = "#f2f2f2", note?: string, marked = false): THREE.CanvasTexture {
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
    g.fillStyle = "#f2f0ea";
    g.fillText(note.toUpperCase(), 262, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
