// How it works: the method and the honest numbers, read straight from the evaluation report.
import type { Index, ModelReport, Report } from "../data";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** "2025 or 2026", or "2023 to 2026" for more than two seasons. */
export function seasonsText(seasons: number[]): string {
  return seasons.length > 2 ? `${Math.min(...seasons)} to ${Math.max(...seasons)}` : seasons.join(" or ");
}

export function howView(index: Index, report: Report): HTMLElement {
  // Headline numbers follow the model the game guesses with (the most accurate one).
  const byId = report as unknown as Record<string, ModelReport>;
  const lr = byId[index.models[0].id];
  const teamChance = 1 / 10;
  const root = document.createElement("div");
  root.className = "page read";
  const sessions = [...lr.sessions].sort((a, b) => b.top1 - a.top1);
  root.innerHTML = `
  <article class="prose">
    <h1 class="display">How it<br>knows</h1>
    <p>Every lap in Blind Lap is a real push lap from ${seasonsText(index.seasons)} qualifying. The name, number and livery are gone. What is left is ${index.features.length} numbers per corner that describe how the car was driven through it, and the model has to find the driver in those.</p>

    <figure>
      ${[
        ["First guess is the driver", lr.top1, lr.chance],
        ["Driver in its top three", lr.top3, lr.chance * 3],
        ["Names the right team", lr.team, teamChance],
        ...(lr.teammate != null ? [["Given the car, picks the right teammate", lr.teammate, 0.5]] : []),
      ]
        .map(
          ([label, v, c]) => `<div class="chart-row num big"><span>${label}</span><span class="track"><i style="width:${(v as number) * 100}%"></i><span class="chance" style="left:${(c as number) * 100}%"></span></span><span>${pct(v as number)}</span></div>`,
        )
        .join("")}
      <figcaption>${lr.laps.toLocaleString("en-GB")} laps from ${lr.sessions.length} qualifying sessions, ${lr.classes.length} drivers. The red tick on each bar is what picking at random would score. The last bar is the hardest test: two drivers, same car, same session, and the model still has to find the right one.</figcaption>
    </figure>
    <p>Each number comes from a circuit the model never trained on. To guess laps at Monza, it was trained on every other circuit, with Monza left out in every year. The game uses those same models, so the guesses you watch are made blind too.</p>

    <h2>From telemetry to corners</h2>
    <ol class="pipeline">
      <li><b>Download</b><span>Car telemetry (speed, throttle, brake, gear, RPM, DRS, about 3.7 samples a second), car position in 3D (about 4 a second) and team radio come from the public OpenF1 API. Corner positions come from MultiViewer's circuit maps.</span></li>
      <li><b>One line per circuit</b><span>The fastest lap's position samples become a smooth closed spline. Every sample of every lap is projected onto it, so 1,200 m means the same spot on track for every driver. Laps that spin, cut or lose data are dropped.</span></li>
      <li><b>Corner zones</b><span>The lap is split into one zone per corner. In each zone we measure where braking starts, how long it lasts, entry speed, minimum speed and where it happens, how soon the driver is back to full throttle, how sharply and how smoothly they open it, the deepest lift, and how far they coast.</span></li>
      <li><b>Against the field</b><span>Each measurement becomes a robust z-score against every other push lap at the same corner in the same session. "Braked 9 m later than the field" survives a change of circuit; "braked at 112 m" does not.</span></li>
      <li><b>Corner type</b><span>Corners are sorted into slow, medium and fast by the field's apex speed, and features go into a separate block per type. Drivers do not brake for a hairpin the way they lift for a sweeper.</span></li>
      <li><b>Models</b><span>Three classifiers (boosted trees, a random forest and a logistic regression) each give P(driver | corner), and a blend averages them. Each corner also comes with its shape (the field's apex and entry speed, and whether it brakes there) and the previous corner's numbers, both known by the time the corner is read. A lap's guess adds up the log-probabilities of its corners, divided by a temperature of ${lr.tau.toFixed(1)} learnt on held-out laps, because the corners of one lap are not independent witnesses.</span></li>
    </ol>

    ${
      report.crossSeason
        ? `<h2>New cars, same drivers</h2>
    <p>2026 brought new cars and new rules. A model trained only on the ${report.crossSeason.train} sessions before it (the same circuits, the old cars) was asked to name the driver of ${report.crossSeason.laps} push laps from ${report.crossSeason.test} sessions of 2026, ${report.crossSeason.drivers} drivers who had raced before. It named the right driver on <strong>${pct(report.crossSeason.top1)}</strong> of laps and had them in its top three on <strong>${pct(report.crossSeason.top3)}</strong> (chance ${pct(report.crossSeason.chance)}). ${
            report.crossSeason.top1 > 2 * report.crossSeason.chance
              ? "Part of a driver's style survives a change of car."
              : "Style learnt in one car carries over to the next only weakly."
          }</p>`
        : ""
    }

    <h2>Three models, one test</h2>
    <p>The same features went into three models, each tested the same way: leave one circuit out, guess every lap there. The game guesses with the most accurate one and lets you switch to the others mid-lap.</p>
    <figure>
      <table class="compare num">
        <thead><tr><th scope="col">Model</th><th scope="col">Right driver</th><th scope="col">In top 3</th><th scope="col">Right team</th><th scope="col">Right teammate</th><th scope="col">Log loss</th></tr></thead>
        <tbody>${index.models
          .map((m) => {
            const r = byId[m.id];
            return `<tr><th scope="row">${m.name}</th><td>${pct(r.top1)}</td><td>${pct(r.top3)}</td><td>${pct(r.team)}</td><td>${r.teammate != null ? pct(r.teammate) : "–"}</td><td>${r.nll.toFixed(2)}</td></tr>`;
          })
          .join("")}</tbody>
      </table>
      <figcaption>Chance: ${pct(lr.chance)} right driver, ${pct(lr.chance * 3)} top 3, 50% teammate. Log loss measures how well the probabilities fit (lower is better; picking at random scores ${Math.log(1 / lr.chance).toFixed(2)}).</figcaption>
    </figure>
    <p><strong>Logistic regression</strong> adds up weight × feature for every driver: easy to read, but it can only draw straight lines between drivers. <strong>Gradient-boosted trees</strong> build decision trees one after another, each fixing the mistakes of the ones before, so they find combinations like "late braker <em>and</em> early throttle"; they are the best single model. The <strong>blend</strong> averages the trees, logistic regression and a random forest (hundreds of trees voting), each on its own scale. They make different mistakes, so together they are right more often than any one of them. A tuned version of the trees, a neural network and models that read a whole lap at once were tested the same way and did no better. None of them runs in your browser: every lap in the game is known in advance, so each model's held-out guess for every corner was computed once and ships with the data. The sentences under the lap ("braked 11 m later than the field") come from the raw measurements, not from a model, so they read the same whichever model guesses.</p>

    <h2>Accuracy by session</h2>
    <figure class="two-col">
      ${sessions
        .map(
          (s) => `<div class="chart-row num"><span>${s.circuit}</span><span class="track"><i style="width:${s.top1 * 100}%"></i><span class="chance" style="left:${lr.chance * 100}%"></span></span><span>${pct(s.top1)}</span></div>`,
        )
        .join("")}
      <figcaption>Top-1 accuracy on each session's laps, with the model trained on every other circuit. The red tick is chance. Short or flat-out circuits give fewer corners to read.</figcaption>
    </figure>

    <h2>Easiest and hardest to spot</h2>
    <figure>
      ${perDriver(lr.classes, lr.confusion)
        .map(
          (d) => `<div class="chart-row num"><span>${d.code}</span><span class="track"><i style="width:${d.acc * 100}%"></i><span class="chance" style="left:${lr.chance * 100}%"></span></span><span>${pct(d.acc)}</span></div>`,
        )
        .join("")}
      <figcaption>Share of each driver's laps where the model's first guess was right. Drivers with a style unlike anyone else's stand out; teammates in similar cars blur together.</figcaption>
    </figure>

    <h2>Who gets mixed up with whom</h2>
    <figure class="confusion"><canvas width="760" height="760" aria-label="Confusion matrix of true driver against model guess"></canvas>
      <figcaption>Rows are the real driver, columns the model's first guess. A bright diagonal is a driver with a clear style. Bright squares off the diagonal are drivers who look alike in this data, often teammates in the same car.</figcaption>
    </figure>

    <h2>What is real, and what is drawn</h2>
    <p><strong>Real, from the car:</strong> speed, gear, throttle, brake and the time at every point of the lap, so where the car brakes, how slow it goes at each apex, when it is back on the power and the lap time are all as driven. The models read only these.</p>
    <p><strong>Drawn:</strong> where across the road the car drives. OpenF1 snaps every car's position to one line, so the data has no line per driver. Each circuit gets a minimum-curvature racing line, and each lap reshapes it from how that lap really took every corner: a later braking point turns in later, the real slowest point moves the apex, an earlier full throttle straightens the exit, and more apex speed than the field swings a fuller arc that may run onto the inside kerb (then the car rides up on it). It is a picture of the real numbers, not a measurement of the line.</p>
    <p><strong>The surroundings</strong> come from OpenStreetMap: real buildings, stands, water and trees, with extra stands and boards only where the map has little.</p>

    <h2>What it cannot see</h2>
    <p>At 300 km/h a car covers about 22 m between telemetry samples, so a single braking point is only known to about ±11 m. The model works because the error averages out over many corners and many laps. It also cannot fully separate the driver from the car: a faster car carries more apex speed whoever drives it. Teammates in the same car are the honest test, and the matrix above shows where it passes and fails.</p>
    <p>The engine you hear is synthesised in your browser from each lap's gear, speed and throttle: the pitch is the firing frequency of a V6 at that RPM. No engine recordings are used. Team radio clips are the real ones from that session.</p>

    <h2>Data</h2>
    <p>Telemetry, positions and radio: <a href="https://openf1.org">OpenF1</a>. Corner maps: MultiViewer. Surroundings (buildings, grandstands, water, woods): map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, ODbL. Car model: based on <a href="https://sketchfab.com/3d-models/free-formula-one-lp-830-sdc-aeebdfa53e294e0390f3c2e8bbfe31b6">"( FREE ) Formula One LP-830 SDC"</a> by <a href="https://sketchfab.com/3Duae">SDC PERFORMANCE</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, textures removed and repainted. Blind Lap is a fan project and is not associated with Formula 1 or any team.</p>
  </article>`;

  drawConfusion(root.querySelector("canvas")!, lr.classes, lr.confusion);
  return root;
}

function perDriver(classes: string[], m: number[][]) {
  return classes
    .map((code, i) => {
      const total = m[i].reduce((a, v) => a + v, 0);
      return { code, acc: total ? m[i][i] / total : 0, total };
    })
    .filter((d) => d.total >= 10)
    .sort((a, b) => b.acc - a.acc);
}

function drawConfusion(canvas: HTMLCanvasElement, classes: string[], m: number[][]) {
  const g = canvas.getContext("2d")!;
  const n = classes.length;
  const pad = 56;
  const cell = (canvas.width - pad) / n;
  // Colours come from the page's tokens, so the chart follows the light or dark theme.
  const css = getComputedStyle(document.documentElement);
  const paper = css.getPropertyValue("--paper").trim();
  const ink = css.getPropertyValue("--ink").trim();
  const ink3 = css.getPropertyValue("--ink-3").trim();
  const red = css.getPropertyValue("--red").trim();
  g.fillStyle = paper;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = `700 13px "Archivo Variable", sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const total = m[i].reduce((a, v) => a + v, 0) || 1;
    g.fillStyle = ink3;
    g.fillText(classes[i], pad - 8, pad + i * cell + cell / 2);
    for (let j = 0; j < n; j++) {
      const v = m[i][j] / total;
      // Ink on the diagonal (right), red off it (confused).
      const a = Math.min(1, v * 1.6);
      g.globalAlpha = i === j ? 0.06 + a * 0.94 : a;
      g.fillStyle = i === j ? ink : red;
      g.fillRect(pad + j * cell + 1, pad + i * cell + 1, cell - 2, cell - 2);
      g.globalAlpha = 1;
    }
  }
  g.save();
  g.textAlign = "left";
  for (let j = 0; j < n; j++) {
    g.save();
    g.translate(pad + j * cell + cell / 2, pad - 8);
    g.rotate(-Math.PI / 2);
    g.fillStyle = ink3;
    g.fillText(classes[j], 0, 0);
    g.restore();
  }
  g.restore();
}
