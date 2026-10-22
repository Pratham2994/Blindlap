// How it works: the method and the honest numbers, read straight from the evaluation report.
import type { Index, Report } from "../data";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function howView(index: Index, report: Report): HTMLElement {
  const lr = report.logreg;
  const gb = report.gbm;
  const teamChance = 1 / 10;
  const root = document.createElement("div");
  root.className = "page read";
  const sessions = [...lr.sessions].sort((a, b) => b.top1 - a.top1);
  root.innerHTML = `
  <article class="prose">
    <h1 class="display">How it<br>knows</h1>
    <p>Every lap in Blind Lap is a real push lap from ${index.seasons.join(" or ")} qualifying. The name, number and livery are gone. What is left is ${index.features.length} numbers per corner that describe how the car was driven through it, and the model has to find the driver in those.</p>

    <figure>
      ${[
        ["First guess is the driver", lr.top1, lr.chance],
        ["Driver in its top three", lr.top3, lr.chance * 3],
        ["Names the right team", lr.team, teamChance],
      ]
        .map(
          ([label, v, c]) => `<div class="chart-row num big"><span>${label}</span><span class="track"><i style="width:${(v as number) * 100}%"></i><span class="chance" style="left:${(c as number) * 100}%"></span></span><span>${pct(v as number)}</span></div>`,
        )
        .join("")}
      <figcaption>${lr.laps} laps from ${lr.sessions.length} qualifying sessions, ${lr.classes.length} drivers. The red tick on each bar is what picking at random would score.</figcaption>
    </figure>
    <p>Each number comes from a circuit the model never trained on. To guess laps at Monza, it was trained on every other circuit, with Monza left out in every year. The game uses those same models, so the guesses you watch are made blind too.</p>

    <h2>From telemetry to corners</h2>
    <ol class="pipeline">
      <li><b>Download</b><span>Car telemetry (speed, throttle, brake, gear, RPM, DRS, about 3.7 samples a second), car position in 3D (about 4 a second) and team radio come from the public OpenF1 API. Corner positions come from MultiViewer's circuit maps.</span></li>
      <li><b>One line per circuit</b><span>The fastest lap's position samples become a smooth closed spline. Every sample of every lap is projected onto it, so 1,200 m means the same spot on track for every driver. Laps that spin, cut or lose data are dropped.</span></li>
      <li><b>Corner zones</b><span>The lap is split into one zone per corner. In each zone we measure where braking starts, how long it lasts, entry speed, minimum speed and where it happens, how soon the driver is back to full throttle, the deepest lift, and how far they coast.</span></li>
      <li><b>Against the field</b><span>Each measurement becomes a robust z-score against every other push lap at the same corner in the same session. "Braked 9 m later than the field" survives a change of circuit; "braked at 112 m" does not.</span></li>
      <li><b>Corner type</b><span>Corners are sorted into slow, medium and fast by the field's apex speed, and features go into a separate block per type. Drivers do not brake for a hairpin the way they lift for a sweeper.</span></li>
      <li><b>Model</b><span>A multinomial logistic regression gives P(driver | corner). A lap's guess adds up the log-probabilities of its corners, divided by a temperature of ${lr.tau.toFixed(1)} learnt on held-out laps, because the corners of one lap are not independent witnesses.</span></li>
    </ol>

    ${
      report.crossSeason
        ? `<h2>New cars, same drivers</h2>
    <p>2026 brought new cars and new rules. A model trained only on ${report.crossSeason.train} sessions of 2025 (the same circuits, the old cars) was asked to name the driver of ${report.crossSeason.laps} push laps from ${report.crossSeason.test} sessions of 2026, ${report.crossSeason.drivers} drivers who raced both years. It named the right driver on <strong>${pct(report.crossSeason.top1)}</strong> of laps and had them in its top three on <strong>${pct(report.crossSeason.top3)}</strong> (chance ${pct(report.crossSeason.chance)}). ${
            report.crossSeason.top1 > 2 * report.crossSeason.chance
              ? "Part of a driver's style survives a change of car."
              : "Style learnt in one car carries over to the next only weakly."
          }</p>`
        : ""
    }

    <h2>Why a simple model</h2>
    <p>A gradient-boosted tree model on the same features scores <strong>${pct(gb.top1)}</strong> top-1 and <strong>${pct(gb.top3)}</strong> top-3, against <strong>${pct(lr.top1)}</strong> and <strong>${pct(lr.top3)}</strong> for logistic regression. The linear model is ${gb.top1 > lr.top1 ? "slightly behind" : "as good or better"}, and it can say why: every corner's push toward a driver is a sum of weight × feature, which is exactly what the evidence line in the game shows. It is also a few kilobytes of weights, so it runs in your browser.</p>

    <h2>Accuracy by circuit</h2>
    <figure>
      ${sessions
        .map(
          (s) => `<div class="chart-row num"><span>${s.circuit}</span><span class="track"><i style="width:${s.top1 * 100}%"></i><span class="chance" style="left:${lr.chance * 100}%"></span></span><span>${pct(s.top1)}</span></div>`,
        )
        .join("")}
      <figcaption>Top-1 accuracy on each circuit's own laps, with the model trained on all the other circuits. The red tick is chance. Short or flat-out circuits give fewer corners to read.</figcaption>
    </figure>

    <h2>Who gets mixed up with whom</h2>
    <figure class="confusion"><canvas width="760" height="760" aria-label="Confusion matrix of true driver against model guess"></canvas>
      <figcaption>Rows are the real driver, columns the model's first guess. A bright diagonal is a driver with a clear style. Bright squares off the diagonal are drivers who look alike in this data, often teammates in the same car.</figcaption>
    </figure>

    <h2>What it cannot see</h2>
    <p>At 300 km/h a car covers about 22 m between telemetry samples, so a single braking point is only known to about ±11 m. The model works because the error averages out over many corners and many laps. It also cannot fully separate the driver from the car: a faster car carries more apex speed whoever drives it. Teammates in the same car are the honest test, and the matrix above shows where it passes and fails.</p>
    <p>The engine you hear is synthesised in your browser from each lap's gear, speed and throttle: the pitch is the firing frequency of a V6 at that RPM. No engine recordings are used. Team radio clips are the real ones from that session.</p>

    <h2>Data</h2>
    <p>Telemetry, positions and radio: <a href="https://openf1.org">OpenF1</a>. Corner maps: MultiViewer. Blind Lap is a fan project and is not associated with Formula 1 or any team.</p>
  </article>`;

  drawConfusion(root.querySelector("canvas")!, lr.classes, lr.confusion);
  return root;
}

function drawConfusion(canvas: HTMLCanvasElement, classes: string[], m: number[][]) {
  const g = canvas.getContext("2d")!;
  const n = classes.length;
  const pad = 56;
  const cell = (canvas.width - pad) / n;
  g.fillStyle = "#0e0e0e";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = `700 13px "Archivo Variable", sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const total = m[i].reduce((a, v) => a + v, 0) || 1;
    g.fillStyle = "#8f8c85";
    g.fillText(classes[i], pad - 8, pad + i * cell + cell / 2);
    for (let j = 0; j < n; j++) {
      const v = m[i][j] / total;
      // Hard white on the diagonal (right), soft red off it (confused).
      const a = Math.min(1, v * 1.6);
      g.fillStyle = i === j ? `rgba(242,240,234,${0.06 + a * 0.94})` : `rgba(232,49,42,${a})`;
      g.fillRect(pad + j * cell + 1, pad + i * cell + 1, cell - 2, cell - 2);
    }
  }
  g.save();
  g.textAlign = "left";
  for (let j = 0; j < n; j++) {
    g.save();
    g.translate(pad + j * cell + cell / 2, pad - 8);
    g.rotate(-Math.PI / 2);
    g.fillStyle = "#8f8c85";
    g.fillText(classes[j], 0, 0);
    g.restore();
  }
  g.restore();
}
