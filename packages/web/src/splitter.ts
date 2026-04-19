// [WEB-SPLITTER] Draggable splitter that persists ratio to localStorage.
// `orientation`: "auto" swaps row/col based on portrait; "row" forces horizontal
// (row-resize, grid-template-rows); "col" forces vertical.

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

export type SplitterOrientation = "auto" | "row" | "col";

const clampRatio = (r: number): number => (r < MIN_RATIO ? MIN_RATIO : r > MAX_RATIO ? MAX_RATIO : r);

const portraitQuery = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(orientation: portrait), (max-width: 767px)")
    : null;

export const initSplitter = (
  app: HTMLElement,
  handle: HTMLElement,
  storageKey = "typediagram-split",
  orientation: SplitterOrientation = "auto",
  defaultRatio = 0.5
) => {
  const stored = localStorage.getItem(storageKey);
  let ratio = stored !== null && stored !== "" ? clampRatio(parseFloat(stored)) : defaultRatio;
  let dragging = false;
  const mq = orientation === "auto" ? portraitQuery() : null;
  const isRow = () => (orientation === "auto" ? mq?.matches === true : orientation === "row");

  const applyRatio = () => {
    const tracks = `${String(ratio)}fr 4px ${String(1 - ratio)}fr`;
    const row = isRow();
    app.style.gridTemplateRows = row ? tracks : "";
    app.style.gridTemplateColumns = row ? "" : tracks;
  };

  applyRatio();
  mq?.addEventListener("change", applyRatio);

  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    document.body.style.cursor = isRow() ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("pointermove", (e) => {
    if (!dragging) {
      return;
    }
    const rect = app.getBoundingClientRect();
    ratio = isRow()
      ? clampRatio((e.clientY - rect.top) / rect.height)
      : clampRatio((e.clientX - rect.left) / rect.width);
    applyRatio();
  });

  const stopDrag = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    localStorage.setItem(storageKey, String(ratio));
  };

  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);
};
