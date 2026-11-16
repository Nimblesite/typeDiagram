// [WEB-ZOOM-CONTROLS] Floating pan/zoom toolbar over the preview pane.
// Glass-style overlay with zoom in, zoom out, reset, fit-to-view, and export buttons.

export type ZoomActions = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  fit: () => void;
};

const BTN = (label: string, title: string) => {
  const b = document.createElement("button");
  b.className = "zoom-btn";
  b.textContent = label;
  b.title = title;
  b.type = "button";
  return b;
};

/** [WEB-EXPORT-SVG] Download the current SVG from the viewport wrapper. */
const exportSvg = (container: HTMLElement) => {
  const svg = container.querySelector(".viewport-wrapper svg");
  if (!(svg instanceof SVGSVGElement)) {
    return;
  }
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "diagram.svg";
  a.click();
  URL.revokeObjectURL(url);
};

export const createZoomControls = (container: HTMLElement, actions: ZoomActions): HTMLElement => {
  const bar = document.createElement("div");
  bar.className = "zoom-controls";

  const btnIn = BTN("+", "Zoom in");
  const btnOut = BTN("\u2212", "Zoom out");
  const btnReset = BTN("1:1", "Reset zoom");
  const btnFit = BTN("\u2922", "Fit to view");
  const btnExport = BTN("\u2913", "Export SVG");

  btnIn.addEventListener("click", actions.zoomIn);
  btnOut.addEventListener("click", actions.zoomOut);
  btnReset.addEventListener("click", actions.reset);
  btnFit.addEventListener("click", actions.fit);
  btnExport.addEventListener("click", () => {
    exportSvg(container);
  });

  bar.appendChild(btnIn);
  bar.appendChild(btnOut);
  bar.appendChild(btnReset);
  bar.appendChild(btnFit);
  bar.appendChild(btnExport);

  container.appendChild(bar);
  return bar;
};
