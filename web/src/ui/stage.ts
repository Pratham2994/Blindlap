// The one WebGL canvas is shared by every page. Each page that shows 3D gives it a frame (an
// element with class "stage-slot"); pages without one park it out of sight.

const parking = document.createElement("div");
parking.className = "stage-parking";
parking.setAttribute("aria-hidden", "true");
document.body.appendChild(parking);

// Held directly, not looked up by id: when a page clears its HTML while the canvas is inside it,
// the canvas leaves the document and getElementById can no longer find it. That lost the 3D view
// (a black stage) after "Next lap" and anywhere else a page rebuilt itself.
const canvas = document.getElementById("stage") as HTMLCanvasElement;

export function dockStage(slot: Element | null) {
  (slot ?? parking).appendChild(canvas);
}

/** Is the canvas on screen in a frame right now (so the page should render)? */
export function stageDocked(): boolean {
  return canvas.parentElement !== parking;
}
