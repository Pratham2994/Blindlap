// Teammate battles: every season's qualifying head-to-head inside each team, from the sessions in
// the game (pipeline/battles.py). Same car, so this is the cleanest way to compare two drivers.
import type { Battles, BattlePair } from "../data";

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(3)}`;

function pairCard(p: BattlePair, colour: string, main: boolean): string {
  const [a, b] = p.drivers;
  const [sa, sb] = p.score;
  const total = sa + sb || 1;
  // The median gap is first driver minus second: negative means the first is faster.
  const g = p.medianGap;
  const faster = g == null ? null : g < 0 ? a : b;
  const gapText =
    g == null
      ? "No common segment times."
      : Math.abs(g) < 0.0005
        ? "Dead level on median gap."
        : `${faster!.code} faster by <b class="num">${Math.abs(g).toFixed(3)} s</b> (median, best laps in the same segment)`;
  const cells = p.rounds
    .map((r) => {
      const wonA = r.winner === a.code;
      const pos = r.pos.map((x) => (x == null ? "no time" : `P${x}`));
      const tip = `${r.circuit} ${r.date.slice(0, 4)}: ${a.code} ${pos[0]}, ${b.code} ${pos[1]}${r.gap != null ? ` · ${r.seg} ${a.code} ${signed(r.gap)} s` : ""}`;
      return `<a class="cell${wonA ? " a" : ""}" href="#/play/${r.key}" title="${tip}" aria-label="${tip}. Won by ${r.winner}."></a>`;
    })
    .join("");
  return `
    <div class="pair${main ? "" : " minor"}">
      <div class="score">
        <span class="who"><b>${a.code}</b><small>${a.name}</small></span>
        <span class="num tally"><b>${sa}</b><i>–</i><b>${sb}</b></span>
        <span class="who right"><b>${b.code}</b><small>${b.name}</small></span>
      </div>
      <div class="split" role="img" aria-label="${a.code} ahead in ${sa} of ${sa + sb} sessions"><i style="width:${(sa / total) * 100}%;background:${colour}"></i></div>
      <p class="gap">${gapText}</p>
      <div class="cells" aria-label="Each session, in order. Filled: ${a.code} qualified ahead. Click one to play a blind lap there.">${cells}</div>
    </div>`;
}

export class BattlesView {
  readonly root: HTMLElement;

  constructor(
    private data: Battles,
    year: string | null,
  ) {
    this.root = document.createElement("div");
    this.root.className = "page battles";
    const years = Object.keys(data.seasons).sort().reverse();
    const pick = year && data.seasons[year] ? year : years[0];
    this.root.innerHTML = `
      <header class="page-head">
        <h1 class="display">Teammate<br>battles</h1>
        <p>Teammates share a car, so beating your teammate is the cleanest test of a driver in qualifying. Each square is one session: filled when the first driver qualified ahead. The gap compares their best laps in the furthest part of qualifying both reached. Only the sessions in the game count.</p>
      </header>
      <div class="seg battle-years" role="group" aria-label="Season">${years.map((y) => `<button type="button" data-year="${y}" aria-pressed="${y === pick}">${y}</button>`).join("")}</div>
      <div class="battle-grid"></div>`;
    this.root.querySelector(".battle-years")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-year]");
      if (!b) return;
      history.replaceState(null, "", `#/battles/${b.dataset.year}`);
      this.show(b.dataset.year!);
    });
    this.show(pick);
  }

  private show(year: string) {
    this.root.querySelectorAll("[data-year]").forEach((b) => b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.year === year)));
    const grid = this.root.querySelector(".battle-grid")!;
    grid.innerHTML = this.data.seasons[year]
      .map(
        (t) => `
        <section class="team" style="--team:${t.colour}">
          <h2 class="caps">${t.team}</h2>
          ${t.pairs.map((p, i) => pairCard(p, t.colour, i === 0)).join("")}
        </section>`,
      )
      .join("");
  }
}
