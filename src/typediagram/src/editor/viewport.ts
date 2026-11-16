// [EDITOR-VIEWPORT] Shared infinite-canvas pan, zoom, fit, and content surface.
import { runWhen, runWhenDefined } from "./effects.js";

export type ViewportState = { scale: number; translateX: number; translateY: number };
export type ViewportControls = ViewportState & {
  wrapper: HTMLElement;
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
};

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_FACTOR = 1.12;
const FIT_PADDING = 56;
const viewports = new WeakMap<HTMLElement, ViewportControls>();

const clamp = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

const renderTransform = (wrapper: HTMLElement, state: ViewportState) => {
  wrapper.style.transform = `translate(${String(state.translateX)}px, ${String(state.translateY)}px) scale(${String(state.scale)})`;
  wrapper.dispatchEvent(new CustomEvent("td:viewport", { detail: { ...state } }));
};

const zoomAt = (state: ViewportState, wrapper: HTMLElement, x: number, y: number, scale: number) => {
  const ratio = scale / state.scale;
  state.translateX = x - ratio * (x - state.translateX);
  state.translateY = y - ratio * (y - state.translateY);
  state.scale = scale;
  renderTransform(wrapper, state);
};

const fitScale = (cw: number, ch: number, sw: number, sh: number) => {
  const hasSize = cw > 0 && ch > 0 && sw > 0 && sh > 0;
  return hasSize ? Math.min((cw - FIT_PADDING * 2) / sw, (ch - FIT_PADDING * 2) / sh, 2) : 1;
};

const fitSvg = (container: HTMLElement, wrapper: HTMLElement, state: ViewportState) => {
  const svg = wrapper.querySelector("svg");
  const hasSvg = svg instanceof SVGSVGElement;
  const sw = hasSvg ? svg.width.baseVal.value : 0;
  const sh = hasSvg ? svg.height.baseVal.value : 0;
  state.scale = hasSvg ? fitScale(container.clientWidth, container.clientHeight, sw, sh) : 1;
  state.translateX = hasSvg ? (container.clientWidth - sw * state.scale) / 2 : 0;
  state.translateY = hasSvg ? (container.clientHeight - sh * state.scale) / 2 : 0;
  renderTransform(wrapper, state);
};

const interactiveTarget = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[data-td-interactive], [data-decl], a, button, input") !== null;

const wheelFactor = (deltaY: number) => {
  const magnitude = Math.min(Math.abs(deltaY), 100) / 100;
  return ZOOM_FACTOR ** (deltaY > 0 ? -magnitude : magnitude);
};

const installWheel = (container: HTMLElement, state: ViewportState, wrapper: HTMLElement) => {
  container.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      zoomAt(
        state,
        wrapper,
        event.clientX - rect.left,
        event.clientY - rect.top,
        clamp(state.scale * wheelFactor(event.deltaY))
      );
    },
    { passive: false }
  );
};

const installPan = (container: HTMLElement, state: ViewportState, wrapper: HTMLElement) => {
  let start: { x: number; y: number; tx: number; ty: number } | undefined;
  container.addEventListener("pointerdown", (event) => {
    start = interactiveTarget(event.target)
      ? undefined
      : { x: event.clientX, y: event.clientY, tx: state.translateX, ty: state.translateY };
    runWhenDefined(start, () => {
      container.setPointerCapture(event.pointerId);
    });
    container.classList.toggle("td-is-panning", start !== undefined);
  });
  container.addEventListener("pointermove", (event) => {
    runWhenDefined(start, (current) => {
      state.translateX = current.tx + event.clientX - current.x;
      state.translateY = current.ty + event.clientY - current.y;
      renderTransform(wrapper, state);
    });
  });
  const stop = () => {
    start = undefined;
    container.classList.remove("td-is-panning");
  };
  container.addEventListener("pointerup", stop);
  container.addEventListener("pointercancel", stop);
};

const makeWrapper = (container: HTMLElement) => {
  const existing = container.querySelector<HTMLElement>(":scope > .viewport-wrapper");
  const wrapper = existing ?? document.createElement("div");
  wrapper.className = "viewport-wrapper";
  wrapper.style.transformOrigin = "0 0";
  runWhen(existing === null, () => {
    container.appendChild(wrapper);
  });
  return wrapper;
};

export const createViewport = (container: HTMLElement): ViewportControls => {
  const state: ViewportState = { scale: 1, translateX: 0, translateY: 0 };
  const wrapper = makeWrapper(container);
  const center = () => ({ x: container.clientWidth / 2, y: container.clientHeight / 2 });
  const reset = () => {
    Object.assign(state, { scale: 1, translateX: 0, translateY: 0 });
    renderTransform(wrapper, state);
  };
  const zoom = (factor: number) => {
    zoomAt(state, wrapper, center().x, center().y, clamp(state.scale * factor));
  };
  installWheel(container, state, wrapper);
  installPan(container, state, wrapper);
  container.style.cursor = "grab";
  const controls: ViewportControls = {
    wrapper,
    reset,
    zoomIn: () => {
      zoom(ZOOM_FACTOR);
    },
    zoomOut: () => {
      zoom(1 / ZOOM_FACTOR);
    },
    fit: () => {
      fitSvg(container, wrapper, state);
    },
    get scale() {
      return state.scale;
    },
    get translateX() {
      return state.translateX;
    },
    get translateY() {
      return state.translateY;
    },
  };
  viewports.set(container, controls);
  return controls;
};

export const setViewportContent = (container: HTMLElement, html: string) => {
  const wrapper = container.querySelector<HTMLElement>(":scope > .viewport-wrapper");
  const target = wrapper ?? container;
  const shouldFit = wrapper?.dataset.fitted !== "true";
  target.innerHTML = html;
  runWhen(wrapper !== null && shouldFit, () => {
    wrapper?.setAttribute("data-fitted", "true");
    viewports.get(container)?.fit();
  });
  return shouldFit;
};
