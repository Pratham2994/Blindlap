import "./styles.css";
import { EngineSynth } from "./audio/engine";
import type { Index } from "./data";
import { loadCareers, loadDna, loadIndex, loadReport, loadSession } from "./data";
import { World } from "./scene/world";
import { dailyPlan, todayKey } from "./ui/daily";
import { DnaView } from "./ui/dna";
import { howView } from "./ui/how";
import { icons } from "./ui/icons";
import { PlayView } from "./ui/play";

interface View {
  root: HTMLElement;
  frame?: (dt: number) => void;
  dispose?: () => void;
}

const view = document.getElementById("view")!;
const world = new World(document.getElementById("stage") as HTMLCanvasElement);
const engine = new EngineSynth();
if (import.meta.env.DEV) (window as unknown as { world: World }).world = world;
let current: View | null = null;
let index: Index;
let titleSession: number | null = null;

function setNav(route: string) {
  document.querySelectorAll<HTMLAnchorElement>(".topbar nav a").forEach((a) => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function mount(v: View) {
  current?.dispose?.();
  view.replaceChildren(v.root);
  current = v;
}

async function titleView(): Promise<View> {
  const report = await loadReport().catch(() => null);
  // Behind the title: a random circuit, orbiting, with its pole-position line laid down.
  if (titleSession === null) titleSession = index.sessions[Math.floor(Math.random() * index.sessions.length)].key;
  const session = await loadSession(titleSession);
  world.setSession(session);
  const fastest = [...session.laps].sort((a, b) => a.lapTime - b.lapTime)[0];
  world.setLap(fastest);
  world.revealLine(true);
  world.showCar(false);
  world.mode = "orbit";
  // The title copy owns the left of the screen: no corner numbers, and the circuit slides right.
  world.labelsOn = false;
  world.setFrameShift(window.innerWidth > 860 ? 0.2 : 0);

  const lr = report?.logreg;
  const root = document.createElement("div");
  root.className = "title";
  root.innerHTML = `
    <h1 class="display">Blind<br>Lap</h1>
    <p class="lede">A real ${index.seasons.join(" or ")} qualifying lap with the name taken off. A model reads how the car takes each corner and guesses who is driving. So do you.</p>
    <div class="actions">
      <a class="btn primary" href="#/play">${icons.play} Start a lap</a>
      <a class="btn" href="#/daily">Daily five</a>
      <a class="btn" href="#/how">How it knows</a>
    </div>
    ${
      lr
        ? `<p class="honest">On circuits it never trained on, the model names the driver <strong>${Math.round(lr.top1 * 100)}%</strong> of the time and has them in its top three <strong>${Math.round(lr.top3 * 100)}%</strong> of the time. Picking at random gets ${Math.round(lr.chance * 100)}%. Sound on: the engine is synthesised from the telemetry. Behind this text: ${session.circuit}, the session's fastest lap.</p>`
        : ""
    }`;
  return { root, frame: (dt) => world.update(dt) };
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, arg] = hash.split("/");
  setNav(name === "daily" ? "play" : name || "home");
  document.body.classList.toggle("reading", name === "how");
  world.labelsOn = true;
  world.setFrameShift(0);
  try {
    if (!index) index = await loadIndex();
    if (name === "play") {
      engine.start();
      engine.setVolume(!engine.muted);
      mount(new PlayView(world, engine, index));
    } else if (name === "daily") {
      engine.start();
      engine.setVolume(!engine.muted);
      const date = todayKey();
      mount(new PlayView(world, engine, index, { date, plan: dailyPlan(index, date) }));
    } else if (name === "dna") {
      const [dna, careers] = await Promise.all([loadDna(), loadCareers()]);
      mount(new DnaView(world, dna, arg ?? null, careers));
    } else if (name === "how") {
      const r = howView(index, await loadReport());
      mount({ root: r, frame: () => {} });
    } else {
      mount(await titleView());
    }
  } catch (e) {
    const root = document.createElement("div");
    root.className = "error";
    root.innerHTML = `<p>Something went wrong loading the data: ${(e as Error).message}.</p>`;
    mount({ root });
  }
}

// Carry the driver from the reveal into the DNA page.
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest("a[href='#/dna']");
  const truth = document.querySelector(".row.truth .code")?.textContent;
  if (a && truth) {
    e.preventDefault();
    location.hash = `#/dna/${truth}`;
  }
});

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
