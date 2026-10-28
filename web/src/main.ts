import "./styles.css";
import * as THREE from "three";
import { EngineSynth } from "./audio/engine";
import type { Index, ModelReport, Report } from "./data";
import { loadCareers, loadDna, loadEnvIndex, loadIndex, loadReport, loadSession } from "./data";
import { LapPlayer } from "./lap";
import { World } from "./scene/world";
import type { CameraMode } from "./scene/world";
import { icons } from "./ui/icons";
import { PlayView } from "./ui/play";
import { dockStage, flushStage } from "./ui/stage";
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
  const swap = () => {
    current?.dispose?.();
    view.replaceChildren(v.root);
    current = v;
    window.scrollTo(0, 0);
    // The new page asked for the 3D view while it was being built; it moves in now it is shown.
    // A page without a frame for it (How, Lab, a lap still loading) gets it parked out of sight.
    if (v.root.querySelector(".stage-slot")) flushStage();
    else dockStage(null);
  };
  // The page changes at once and its own content fades in (CSS "arrive"). A browser view
  // transition was tried and removed: it froze a picture of the old page while the new one built
  // its circuit, so the old page hung on screen with an empty 3D box for most of a second.
  swap();
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

async function homeView(): Promise<View> {
  // The page shows at once; the numbers and the 3D broadcast fill in when their data arrives.
  const report = (await Promise.race([loadReport().catch(() => null), new Promise((r) => setTimeout(() => r(null), 150))])) as Report | null;
  const best = report ? (report as unknown as Record<string, ModelReport>)[index.models[0].id] : null;
  let player: LapPlayer | null = null;
  const shots: CameraMode[] = ["tv", "chase", "side", "tv", "heli"];
  let t = 0;
  let shot = 0;
  let shotTime = 0;
  let caption = "Loading a circuit";
  // Beside the headline: a broadcast of a random circuit's fastest lap, cutting between cameras.
  // Daytime sessions only, so the first thing a visitor sees is never a dark night scene.
  const startBroadcast = async () => {
    if (homeSession === null) {
      const env = await loadEnvIndex();
      const day = index.sessions.filter((s) => env[String(s.key)]?.light === "day");
      const pool = day.length ? day : index.sessions;
      homeSession = pool[Math.floor(Math.random() * pool.length)].key;
    }
    const session = await loadSession(homeSession);
    if (current?.root !== root) return; // the visitor already left the home page
    // Back on the home page with the same circuit: the scene is already built.
    if (world.sessionShown !== session.key) world.setSession(session);
    const fastest = [...session.laps].sort((a, b) => a.lapTime - b.lapTime)[0];
    world.setLap(fastest);
    world.revealLine(false);
    world.hideLivery();
    world.showCar(true);
    world.labelsOn = false;
    player = new LapPlayer(fastest);
    t = player.duration * Math.random();
    world.mode = shots[0];
    world.setCarS(player.at(t).s);
    world.snapCamera();
    caption = `${session.circuit} ${session.date.slice(0, 4)} · fastest lap of the session · who is it?`;
    const cap = root.querySelector(".hero-stage figcaption");
    if (cap) cap.textContent = caption;
    root.querySelector(".hero-stage")?.classList.add("ready");
  };

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
        <figcaption class="caps">${caption}</figcaption>
      </figure>
    </section>

    <section class="howto" aria-label="How to play">
      <h2 class="caps">How to play</h2>
      <ol>
        <li><b>Watch</b><span>A real qualifying lap, the driver's name hidden. Same car colours for everyone.</span></li>
        <li><b>Read</b><span>Where they brake, how much speed they carry, when they get back on the power. Every driver has a signature.</span></li>
        <li><b>Guess</b><span>Tap a driver before the flag. Right: 3 points, their teammate: 1. Hints help, and cost a point each.</span></li>
        <li><b>Reveal</b><span>Who it was, how three models read the same lap, and their team radio.</span></li>
      </ol>
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
  // Start the 3D after the page has painted, so the text never waits for it.
  requestAnimationFrame(() => setTimeout(() => void startBroadcast(), 0));
  return {
    root,
    frame: (dt) => {
      if (!player) return;
      // Drive the lap at real speed, loop it, and cut to the next camera every 6 seconds.
      t = (t + dt) % player.duration;
      const smp = player.at(t);
      world.setCarS(smp.s);
      shotTime += dt;
      if (shotTime > 6) {
        shotTime = 0;
        shot = (shot + 1) % shots.length;
        world.mode = shots[shot];
      }
      world.update(dt, smp.speed, smp.brake);
    },
  };
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
      const { DnaView } = await import("./ui/dna");
      mount(new DnaView(world, dna, arg ?? null, careers));
    } else if (name === "lab") {
      const { LabView } = await import("./ui/lab");
      mount(new LabView(index));
    } else if (name === "how") {
      const [{ howView }, report] = await Promise.all([import("./ui/how"), loadReport()]);
      mount({ root: howView(index, report) });
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
