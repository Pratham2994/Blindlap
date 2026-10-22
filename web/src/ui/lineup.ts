// The model's grid: one row per driver, re-sorted after every corner. Clicking a row is your guess.
import type { DriverInfo } from "../data";
import type { Guess } from "../model";

const ROW = 34;

export class Lineup {
  readonly root: HTMLElement;
  private list: HTMLOListElement;
  private rows = new Map<string, HTMLButtonElement>();
  private hint: HTMLParagraphElement;
  private counter: HTMLSpanElement;
  pick: string | null = null;
  locked = false;
  onPick: (code: string) => void = () => {};

  constructor(codes: string[], drivers: Record<string, DriverInfo>) {
    this.root = document.createElement("section");
    this.root.className = "lineup";
    this.root.setAttribute("aria-label", "The model's guess. Pick a driver to make yours.");
    this.root.innerHTML = `<header><span class="caps">Model's grid</span><span class="caps num" data-k="count">0 corners read</span></header>`;
    this.counter = this.root.querySelector("[data-k=count]")!;
    this.list = document.createElement("ol");
    this.root.appendChild(this.list);
    this.hint = document.createElement("p");
    this.hint.className = "hint";
    this.hint.innerHTML = "Tap a driver to lock your guess. You can change it until the flag.";
    this.root.appendChild(this.hint);

    const info = new Map(Object.values(drivers).map((d) => [d.code, d]));
    codes.forEach((code, i) => {
      const d = info.get(code);
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.className = "row";
      b.type = "button";
      b.style.transform = `translateY(${i * ROW}px)`;
      b.innerHTML = `<span class="chip" style="background:${d?.colour ?? "#888"}"></span><span class="code">${code}</span><span class="bar"><i></i></span><span class="pct num">–</span>`;
      b.setAttribute("aria-label", `${d?.name ?? code}, ${d?.team ?? ""}`);
      b.addEventListener("click", () => this.choose(code));
      li.appendChild(b);
      this.list.appendChild(li);
      this.rows.set(code, b);
    });
    this.list.style.minHeight = `${codes.length * ROW}px`;
  }

  choose(code: string) {
    if (this.locked) return;
    this.pick = code;
    for (const [c, r] of this.rows) r.classList.toggle("pick", c === code);
    this.hint.innerHTML = `Your guess: <b>${code}</b>. Change it any time before the flag.`;
    this.onPick(code);
  }

  update(guesses: Guess[], corners: number) {
    const top = guesses[0]?.p ?? 1;
    guesses.forEach((g, i) => {
      const r = this.rows.get(g.code);
      if (!r) return;
      r.style.transform = `translateY(${i * ROW}px)`;
      r.classList.toggle("lead", i === 0 && corners > 0);
      (r.querySelector(".bar i") as HTMLElement).style.width = `${(g.p / top) * 100}%`;
      r.querySelector(".pct")!.textContent = corners > 0 ? `${Math.round(g.p * 100)}%` : "–";
    });
    this.counter.textContent = `${corners} corner${corners === 1 ? "" : "s"} read`;
  }

  reveal(truth: string) {
    this.locked = true;
    this.rows.get(truth)?.classList.add("truth");
    this.hint.textContent = "Green is who was really driving.";
  }
}
