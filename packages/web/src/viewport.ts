// [WEB-VIEWPORT] Pan + zoom for the SVG preview container.
// Applies CSS transform to a wrapper div inside #preview.

export type ViewportState = {
  scale: number;
  translateX: number;
  translateY: number;
};

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.1;

const clampScale = (s: number): number => (s < ZOOM_MIN ? ZOOM_MIN : s > ZOOM_MAX ? ZOOM_MAX : s);

export type ViewportControls = ViewportState & {
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
};

export const createViewport = (container: HTMLElement): ViewportControls => {
  const state: ViewportState = { scale: 1, translateX: 0, translateY: 0 };

  const wrapper = document.createElement("div");
  wrapper.className = "viewport-wrapper";
  wrapper.style.transformOrigin = "0 0";
  container.appendChild(wrapper);

  const apply = () => {
    wrapper.style.transform = `translate(${String(state.translateX)}px, ${String(state.translateY)}px) scale(${String(state.scale)})`;
  };

  // --- Zoom (wheel) ---
  container.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const prevScale = state.scale;
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      state.scale = clampScale(prevScale + delta * prevScale);

      const ratio = state.scale / prevScale;
      state.translateX = mx - ratio * (mx - state.translateX);
      state.translateY = my - ratio * (my - state.translateY);
      apply();
    },
    { passive: false }
  );

  // --- Pan (pointer drag) ---
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  container.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    const isInteractive = target.tagName === "A" || target.tagName === "BUTTON";
    if (isInteractive) {
      return;
    }
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startTx = state.translateX;
    startTy = state.translateY;
    if (typeof container.setPointerCapture === "function") {
      container.setPointerCapture(e.pointerId);
    }
    container.style.cursor = "grabbing";
  });

  container.addEventListener("pointermove", (e) => {
    if (!dragging) {
      return;
    }
    state.translateX = startTx + (e.clientX - startX);
    state.translateY = startTy + (e.clientY - startY);
    apply();
  });

  const stopDrag = () => {
    dragging = false;
    container.style.cursor = "grab";
  };
  container.addEventListener("pointerup", stopDrag);
  container.addEventListener("pointercancel", stopDrag);

  container.style.cursor = "grab";

  const reset = () => {
    state.scale = 1;
    state.translateX = 0;
    state.translateY = 0;
    apply();
  };

  const zoomIn = () => {
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const prevScale = state.scale;
    state.scale = clampScale(prevScale + ZOOM_STEP * prevScale);
    const ratio = state.scale / prevScale;
    state.translateX = cx - ratio * (cx - state.translateX);
    state.translateY = cy - ratio * (cy - state.translateY);
    apply();
  };

  const zoomOut = () => {
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const prevScale = state.scale;
    state.scale = clampScale(prevScale - ZOOM_STEP * prevScale);
    const ratio = state.scale / prevScale;
    state.translateX = cx - ratio * (cx - state.translateX);
    state.translateY = cy - ratio * (cy - state.translateY);
    apply();
  };

  const fit = () => {
    const svg = wrapper.querySelector("svg");
    if (svg instanceof SVGSVGElement) {
      fitSvg(container, wrapper, svg);
    } else {
      reset();
    }
  };

  return {
    ...state,
    reset,
    zoomIn,
    zoomOut,
    fit,
    get scale() {
      return state.scale;
    },
  };
};

/**
 * [WEB-VIEWPORT-PRESERVE] Move rendered content into the viewport wrapper.
 * Fit-to-container runs ONLY on the first ever render — once the user has
 * interacted (or any non-identity transform is set) we leave it alone so
 * their pan/zoom survives subsequent re-renders.
 */
export const setViewportContent = (container: HTMLElement, html: string) => {
  const wrapper = container.querySelector<HTMLElement>(".viewport-wrapper");
  const target = wrapper ?? container;
  const priorTransform = wrapper?.style.transform ?? "";
  target.innerHTML = html;

  const svg = target.querySelector("svg");
  const hasWrapper = wrapper instanceof HTMLElement;
  if (svg === null || !hasWrapper) {
    return;
  }
  if (priorTransform === "") {
    fitSvg(container, wrapper, svg);
    return;
  }
  wrapper.style.transform = priorTransform;
};

const FIT_PADDING = 16;

const fitSvg = (container: HTMLElement, wrapper: HTMLElement, svg: SVGSVGElement) => {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const sw = svg.width.baseVal.value;
  const sh = svg.height.baseVal.value;

  const noSize = sw === 0 || sh === 0 || cw === 0 || ch === 0;
  const scale = noSize ? 1 : Math.min((cw - FIT_PADDING * 2) / sw, (ch - FIT_PADDING * 2) / sh, 2);

  const tx = (cw - sw * scale) / 2;
  const ty = (ch - sh * scale) / 2;
  wrapper.style.transform = `translate(${String(tx)}px, ${String(ty)}px) scale(${String(scale)})`;
};
