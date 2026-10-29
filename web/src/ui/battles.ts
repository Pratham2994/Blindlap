// Teammate battles: every season's qualifying head-to-head inside each team, from the sessions in
// the game (pipeline/battles.py). Same car, so this is the cleanest way to compare two drivers.
import type { Battles, BattlePair } from "../data";
import { traitLabel } from "./traits";

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(3)}`;

/** How two teammates drive differently in the same car: each trait as a bar toward the driver who
 * had more of it, with the sessions it held in; then the clearest single corners. */
function styleBlock(p: BattlePair, scale: Record<string, number>): string {
  const [a, b] = p.drivers;
  const st = p.style;
  const n = Object.values(st.traits)[0]?.sessions ?? 0;
  if (n < 3) return "";
  const rows = Object.entries(st.traits)
    .map(([k, t]) => {
      const x = Math.max(-1, Math.min(1, t.diff / (scale[k] || 1)));
      const who = t.diff > 0 ? a.code : b.code;
      const held = t.diff > 0 ? t.more : t.sessions - t.more;
      // First driver on the left, as in the score above: a bar to the left means the first had more.
      const bar = x > 0 ? `right:50%;width:${x * 50}%` : `left:50%;width:${-x * 50}%`;
      return `<div class="diff-row"><span class="k">${traitLabel(k)}</span><span class="track" role="img" aria-label="${who} more, in ${held} of ${t.sessions} sessions"><i style="${bar}"></i></span><span class="num held">${who} <b>${held}</b>/${t.sessions}</span></div>`;
    })
    .join("");
  const corners = st.corners.length
    ? `<p class="caps diff-h">Clearest corners</p><ul class="diff-corners">${st.corners
        .map(
          (c) =>
            `<li><a href="#/play/${c.key}" title="Play a blind lap of this session">${c.circuit} · Turn ${c.corner}</a><span><b>${a.code}</b> ${c.text} than ${b.code}</span><small class="num">median of ${c.laps[0]} and ${c.laps[1]} laps</small></li>`,
        )
        .join("")}</ul>`
    : "";
  return `
    <details class="pair-style">
      <summary>How they drive differently</summary>
      <p class="diff-note">Same car, so the differences are the drivers'. Each bar points to the driver who did more of it, on average over the ${n} sessions they both have laps in; the count is in how many of those sessions. ${st.clearCorners} single corners had a gap well clear of their lap-to-lap scatter; the clearest are below.</p>
      <div class="diff-key num"><span>← ${a.code} more</span><span>${b.code} more →</span></div>
      ${rows}
      ${corners}
    </details>`;
}

function pairCard(p: BattlePair, main: boolean, scale: Record<string, number>): string {
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
      <div class="split" role="img" aria-label="${a.code} ahead in ${sa} of ${sa + sb} sessions"><i style="width:${(sa / total) * 100}%"></i></div>
      <p class="gap">${gapText}</p>
      <div class="cells" aria-label="Each session, in order. Filled: ${a.code} qualified ahead. Click one to play a blind lap there.">${cells}</div>
      ${styleBlock(p, scale)}
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
        <p>Teammates share a car, so beating your teammate is the cleanest test of a driver in qualifying. Each square is one session: filled when the first driver qualified ahead. The gap compares their best laps in the furthest part of qualifying both reached. Open "How they drive differently" to see where two teammates take the same corners in different ways. Only the sessions in the game count.</p>
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
          ${t.pairs.map((p, i) => pairCard(p, i === 0, this.data.traitScale ?? {})).join("")}
        </section>`,
      )
      .join("");
  }
}
