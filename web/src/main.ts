import "./styles.css";
import * as THREE from "three";
import { EngineSynth } from "./audio/engine";
import type { Index, ModelReport, Report } from "./data";
import { loadCareers, loadDna, loadIndex, loadReport, loadSession } from "./data";
import { World } from "./scene/world";
import { DnaView } from "./ui/dna";
import { howView } from "./ui/how";
import { icons } from "./ui/icons";
import { LabView } from "./ui/lab";
import { PlayView } from "./ui/play";
import { dockStage } from "./ui/stage";
import { isDark, onTheme, setTheme } from "./theme";

interface View {
  root: HTMLElement;
  frame?: (dt: number) => void;
  dispose?: () => void;
}

const view = document.getElementById("view")!;
const world = new World(document.getElementById("stage") as HTMLCanvasElement);
const engine = new EngineSynth();
// Development builds expose these to the check scripts in web/scripts.
if (import.meta.env.DEV) Object.assign(window, { world, engine, THREE });
let current: View | null = null;
let index: Index;
let homeSession: number | null = null;

function setNav(route: string) {
  document.querySelectorAll<HTMLAnchorElement>(".topbar nav a").forEach((a) => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

// Phone menu: one button opens the nav as a sheet; any navigation closes it.
const toggle = document.querySelector<HTMLButtonElement>(".menu-toggle")!;
toggle.addEventListener("click", () => {
  const open = !document.body.classList.contains("nav-open");
  document.body.classList.toggle("nav-open", open);
  toggle.setAttribute("aria-expanded", String(open));
});

// Theme: one button in the top bar. The 3D world recolours live; pages that paint their own
// canvas (DNA, How) are rebuilt.
const themeButton = document.querySelector<HTMLButtonElement>(".theme-toggle")!;
function showTheme() {
  const dark = isDark();
  themeButton.textContent = dark ? "Light" : "Dark";
  themeButton.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  world.setDark(dark);
}
themeButton.addEventListener("click", () => setTheme(isDark() ? "light" : "dark"));
onTheme(() => {
  showTheme();
  const name = location.hash.replace(/^#\/?/, "").split("/")[0];
  if (name === "dna" || name === "how") void route();
});
showTheme();

function mount(v: View) {
  current?.dispose?.();
  view.replaceChildren(v.root);
  current = v;
  window.scrollTo(0, 0);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

async function homeView(): Promise<View> {
  const report = (await loadReport().catch(() => null)) as Report | null;
  const best = report ? (report as unknown as Record<string, ModelReport>)[index.models[0].id] : null;
  // Beside the headline: a random circuit, orbiting, with the session's fastest lap laid down.
  if (homeSession === null) homeSession = index.sessions[Math.floor(Math.random() * index.sessions.length)].key;
  const session = await loadSession(homeSession);
  world.setSession(session);
  const fastest = [...session.laps].sort((a, b) => a.lapTime - b.lapTime)[0];
  world.setLap(fastest);
  world.revealLine(true);
  world.showCar(false);
  world.mode = "orbit";
  world.labelsOn = false;

  const laps = index.sessions.reduce((a, s) => a + s.laps, 0);
  const root = document.createElement("div");
  root.className = "home";
  root.innerHTML = `
    <section class="hero">
      <div class="hero-block">
        <h1 class="display">Who's<br>driving?</h1>
        <p class="lede">A real ${index.seasons.join(" or ")} F1 qualifying lap with the name taken off. Three models read every corner and guess the driver. So do you.</p>
        <a class="btn on-red" href="#/play">${icons.play} Start a lap</a>
      </div>
      <figure class="hero-stage frame">
        <div class="stage-slot"></div>
        <figcaption class="caps">${session.circuit} ${session.date.slice(0, 4)} · fastest lap of the session</figcaption>
      </figure>
    </section>

    <section class="modes" aria-label="Ways to play">
      <a class="mode quick" href="#/play"><h2 class="display">Quick lap</h2><p>One random lap from ${index.sessions.length} qualifying sessions. Sound on.</p><span class="go">${icons.next}</span></a>
      <a class="mode" href="#/mates"><h2 class="display">Teammates</h2><p>Same car, two drivers. Which one is at the wheel?</p><span class="go">${icons.next}</span></a>
      <label class="mode pick"><h2 class="display">Pick a circuit</h2>
        <select aria-label="Pick a circuit to play">
          <option value="">Choose a circuit</option>
          ${index.seasons
            .slice()
            .reverse()
            .map(
              (y) =>
                `<optgroup label="${y}">${index.sessions
                  .filter((s) => s.year === y)
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((s) => `<option value="${s.key}">${s.circuit} ${y}</option>`)
                  .join("")}</optgroup>`,
            )
            .join("")}
        </select>
      </label>
    </section>


    ${
      best
        ? `<section class="facts num" aria-label="The numbers">
            <p><b>${index.sessions.length}</b> qualifying sessions</p>
            <p><b>${laps.toLocaleString("en-GB")}</b> laps in the game</p>
            <p><b>${pct(best.top1)}</b> first guess right · chance ${pct(best.chance)}</p>
            ${best.teammate != null ? `<p><b>${pct(best.teammate)}</b> right teammate · chance 50%</p>` : ""}
          </section>`
        : ""
    }`;
  root.querySelector("select")!.addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v) location.hash = `#/play/${v}`;
  });
  dockStage(root.querySelector(".stage-slot"));
  return { root, frame: (dt) => world.update(dt) };
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, arg] = hash.split("/");
  document.body.classList.remove("nav-open");
  toggle.setAttribute("aria-expanded", "false");
  setNav(name === "mates" ? "play" : name || "home");
  document.body.dataset.route = name || "home";
  world.labelsOn = true;
  world.setFrameShift(0);
  dockStage(null);
  try {
    if (!index) index = await loadIndex();
    if (name === "play") {
      engine.start();
      engine.setActive(true);
      // #/play/<session>.<lap> is a challenge link; #/play/<session> is any lap at that circuit.
      const [key, lap] = (arg ?? "").split(".");
      const k = Number(key);
      const lapIndex = lap === undefined ? -1 : Number(lap);
      const challenge = key && Number.isInteger(k) && Number.isInteger(lapIndex) && index.sessions.some((s) => s.key === k) ? { key: k, lapIndex } : null;
      mount(new PlayView(world, engine, index, challenge));
    } else if (name === "mates") {
      engine.start();
      engine.setActive(true);
      mount(new PlayView(world, engine, index, null, true));
    } else if (name === "dna") {
      const [dna, careers] = await Promise.all([loadDna(), loadCareers()]);
      mount(new DnaView(world, dna, arg ?? null, careers));
    } else if (name === "lab") {
      mount(new LabView(index));
    } else if (name === "how") {
      mount({ root: howView(index, await loadReport()) });
    } else {
      mount(await homeView());
    }
  } catch (e) {
    const root = document.createElement("div");
    root.className = "error";
    root.innerHTML = `<p>Couldn't load the data: ${(e as Error).message}.</p><a class="btn" href="#/">Back to the menu</a>`;
    mount({ root });
  }
}

window.addEventListener("hashchange", route);
void route();

let last = performance.now();
function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  current?.frame?.(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
