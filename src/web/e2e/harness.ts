// [WEB-E2E-HARNESS-BOOT] Exposes the src/ UI modules on window.__E2E for the
// Playwright specs. Everything is imported statically so Rollup bundles it
// into a single chunk; specs just call the function they need.
import { initSplitter } from "../src/splitter.js";
import { createViewport, setViewportContent } from "../src/viewport.js";
import { createZoomControls } from "../src/zoom-controls.js";
import { initEditorZoom } from "../src/editor-zoom.js";
import { mountConverter } from "../src/converter.js";
import { mountPlayground } from "../src/playground.js";

declare global {
  interface Window {
    __E2E: {
      initSplitter: typeof initSplitter;
      createViewport: typeof createViewport;
      setViewportContent: typeof setViewportContent;
      createZoomControls: typeof createZoomControls;
      initEditorZoom: typeof initEditorZoom;
      mountConverter: typeof mountConverter;
      mountPlayground: typeof mountPlayground;
      reset: () => void;
    };
    __E2E_ZC_CALLS: { zoomIn: number; zoomOut: number; reset: number; fit: number };
    __E2E_VP: ReturnType<typeof createViewport>;
    __E2E_VP2: ReturnType<typeof createViewport>;
  }
}

const reset = (): void => {
  const mount = document.getElementById("e2e-mount");
  const extra = document.getElementById("e2e-extra");
  if (mount !== null) {
    mount.replaceChildren();
  }
  if (extra !== null) {
    extra.replaceChildren();
  }
  localStorage.clear();
};

window.__E2E = {
  initSplitter,
  createViewport,
  setViewportContent,
  createZoomControls,
  initEditorZoom,
  mountConverter,
  mountPlayground,
  reset,
};
