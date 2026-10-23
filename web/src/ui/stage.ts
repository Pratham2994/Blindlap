// The one WebGL canvas is shared by every page. Each page that shows 3D gives it a frame (an
// element with class "stage-slot"); pages without one park it out of sight.

const parking = document.createElement("div");
parking.className = "stage-parking";
parking.setAttribute("aria-hidden", "true");
document.body.appendChild(parking);

export function dockStage(slot: Element | null) {
  const canvas = document.getElementById("stage");
  if (!canvas) return;
  (slot ?? parking).appendChild(canvas);
}

/** Is the canvas on screen in a frame right now (so the page should render)? */
export function stageDocked(): boolean {
  return document.getElementById("stage")?.parentElement !== parking;
}
