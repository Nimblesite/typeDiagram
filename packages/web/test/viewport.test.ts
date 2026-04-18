// [WEB-VIEWPORT-TEST] Integration test for pan/zoom viewport.
import { describe, expect, it, beforeEach } from "vitest";
import { createViewport, setViewportContent } from "../src/viewport.js";

describe("[WEB-VIEWPORT]", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "preview";
    document.body.appendChild(container);
  });

  it("creates a viewport-wrapper child", () => {
    createViewport(container);
    const wrapper = container.querySelector(".viewport-wrapper");
    expect(wrapper).not.toBeNull();
  });

  it("sets grab cursor on container", () => {
    createViewport(container);
    expect(container.style.cursor).toBe("grab");
  });

  it("setViewportContent puts HTML into the wrapper", () => {
    createViewport(container);
    setViewportContent(container, "<svg>test</svg>");
    const wrapper = container.querySelector(".viewport-wrapper");
    expect(wrapper?.innerHTML).toBe("<svg>test</svg>");
  });

  it("zoom changes transform on wheel event", () => {
    createViewport(container);
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;

    container.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 400, clientY: 300, bubbles: true }));
    expect(wrapper.style.transform).toContain("scale(");
    expect(wrapper.style.transform).not.toBe("scale(1)");
  });

  it("pan changes transform on pointer drag", () => {
    createViewport(container);
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;

    container.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 100, bubbles: true })
    );
    container.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 150, bubbles: true }));
    expect(wrapper.style.transform).toContain("translate(100px, 50px)");

    container.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(container.style.cursor).toBe("grab");
  });

  it("calls setPointerCapture on container when available", () => {
    createViewport(container);
    const captured: number[] = [];
    Object.defineProperty(container, "setPointerCapture", {
      value: (id: number) => captured.push(id),
      configurable: true,
    });
    container.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 77, clientX: 100, clientY: 100, bubbles: true })
    );
    expect(captured).toEqual([77]);
    container.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });

  it("ignores pointerdown on anchor elements", () => {
    createViewport(container);
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    const link = document.createElement("a");
    container.appendChild(link);
    link.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    link.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 200, bubbles: true }));
    expect(wrapper.style.transform).toBe("");
  });

  it("ignores pointerdown on button elements", () => {
    createViewport(container);
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    const btn = document.createElement("button");
    container.appendChild(btn);
    btn.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    btn.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 200, bubbles: true }));
    expect(wrapper.style.transform).toBe("");
  });

  it("pointermove without drag does nothing", () => {
    createViewport(container);
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    container.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 200, bubbles: true }));
    expect(wrapper.style.transform).toBe("");
  });

  it("pointercancel stops drag", () => {
    createViewport(container);
    container.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
    container.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    expect(container.style.cursor).toBe("grab");
  });

  it("clamps zoom to min/max bounds", () => {
    createViewport(container);
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    // Zoom out many times to hit min
    for (let i = 0; i < 100; i++) {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, clientX: 400, clientY: 300, bubbles: true }));
    }
    expect(wrapper.style.transform).toContain("scale(0.1)");
    // Zoom in many times to hit max
    for (let i = 0; i < 200; i++) {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 400, clientY: 300, bubbles: true }));
    }
    expect(wrapper.style.transform).toContain("scale(5)");
  });

  it("setViewportContent falls back to container when no wrapper", () => {
    // No createViewport called, so no .viewport-wrapper
    const bare = document.createElement("div");
    setViewportContent(bare, "<p>test</p>");
    expect(bare.innerHTML).toBe("<p>test</p>");
  });

  it("fitSvg handles zero-size SVG gracefully", () => {
    createViewport(container);
    setViewportContent(container, `<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    expect(wrapper.style.transform).not.toContain("NaN");
    expect(wrapper.style.transform).not.toContain("Infinity");
  });

  it("fitSvg scales SVG to fit container when both have size", () => {
    createViewport(container);
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    setViewportContent(container, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`);
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    // Should contain a scale transform (fitted)
    expect(wrapper.style.transform).toContain("scale(");
    expect(wrapper.style.transform).not.toContain("NaN");
  });

  it("zoomIn increases scale", () => {
    const vp = createViewport(container);
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    vp.zoomIn();
    expect(wrapper.style.transform).toContain("scale(");
    expect(wrapper.style.transform).not.toContain("scale(1)");
  });

  it("zoomOut decreases scale", () => {
    const vp = createViewport(container);
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    vp.zoomOut();
    expect(wrapper.style.transform).toContain("scale(");
  });

  it("fit with SVG calls fitSvg to scale content", () => {
    const vp = createViewport(container);
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "400");
    svg.setAttribute("height", "300");
    wrapper.appendChild(svg);
    expect(svg instanceof SVGSVGElement).toBe(true);
    vp.fit();
    expect(wrapper.style.transform).toContain("scale(");
    expect(wrapper.style.transform).not.toBe("translate(0px, 0px) scale(1)");
  });

  it("fit without SVG calls reset", () => {
    const vp = createViewport(container);
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;
    vp.zoomIn();
    vp.fit();
    expect(wrapper.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("scale getter reflects current zoom", () => {
    const vp = createViewport(container);
    expect(vp.scale).toBe(1);
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    vp.zoomIn();
    expect(vp.scale).toBeGreaterThan(1);
  });

  it("reset restores identity transform", () => {
    const vp = createViewport(container);
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;

    container.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
    container.dispatchEvent(new PointerEvent("pointermove", { clientX: 50, clientY: 50, bubbles: true }));
    container.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    vp.reset();
    expect(wrapper.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  // [WEB-VIEWPORT-PRESERVE] Bug: re-rendering (setViewportContent) wipes the
  // user's pan/zoom. After the first render fit-zooms the content, subsequent
  // renders must preserve whatever transform the user has since applied.
  it("setViewportContent PRESERVES user pan after first render", () => {
    createViewport(container);
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;

    // First render: fit kicks in — acceptable.
    setViewportContent(container, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`);

    // User pans the viewport.
    container.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
    container.dispatchEvent(new PointerEvent("pointermove", { clientX: 123, clientY: 77, bubbles: true }));
    container.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    const afterPan = wrapper.style.transform;
    expect(afterPan).toContain("translate(");
    // grab one of the translate offsets — must not be (0,0) after a pan.
    expect(afterPan).not.toBe("translate(0px, 0px) scale(1)");

    // Re-render with NEW content.
    setViewportContent(container, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`);
    const afterRerender = wrapper.style.transform;

    // BUG: today the transform gets reset to "fit" — wiping the user's pan.
    expect(afterRerender).toBe(afterPan);
  });

  it("setViewportContent PRESERVES user zoom after first render", () => {
    createViewport(container);
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    const wrapper = container.querySelector(".viewport-wrapper") as HTMLElement;

    setViewportContent(container, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`);

    // User zooms in (e.g. wheel).
    container.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 400, clientY: 300, bubbles: true }));
    const afterZoom = wrapper.style.transform;

    setViewportContent(container, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`);
    const afterRerender = wrapper.style.transform;

    expect(afterRerender).toBe(afterZoom);
  });
});
