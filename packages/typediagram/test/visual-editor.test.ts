// @vitest-environment happy-dom
// [EDITOR-CANVAS-TEST] Whole visual editor in a browser DOM: render, edit, drag, connect, zoom, persist.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "../src/index.js";
import {
  createVisualEditor,
  createViewport,
  installVisualEditorStyles,
  setViewportContent,
  VISUAL_EDITOR_CSS,
} from "../src/editor/index.js";

const SOURCE = `typeDiagram

type Account {
  owner: Profile
  active: Bool
}

type Profile {
  name: String
}

union State {
  Loading
  Ready { account: Account }
}

alias Owner = Profile
`;

const size = (element: HTMLElement, width = 900, height = 640) => {
  Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: height });
};

const pointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y });

const clickNode = (node: SVGGElement | null | undefined, x: number, y: number) => {
  node?.dispatchEvent(pointer("pointerdown", x, y));
  node?.ownerSVGElement?.dispatchEvent(pointer("pointerup", x, y));
};

const render = async (source: string) => {
  const result = await renderToString(source, { theme: "dark" });
  expect(result.ok).toBe(true);
  return result.ok ? result.value : "";
};

describe("[EDITOR-CANVAS] shared web and VS Code interaction runtime", () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("supports the full direct-manipulation workflow and all canvas controls", async () => {
    const container = document.createElement("section");
    size(container);
    document.body.appendChild(container);
    let source = SOURCE;
    const changes: string[] = [];
    const positions: Array<Readonly<Record<string, { x: number; y: number }>>> = [];
    const editor = createVisualEditor(container, {
      getSource: () => source,
      onSourceChange: (next) => {
        source = next;
        changes.push(next);
      },
      initialPositions: { Profile: { x: 16, y: 8 } },
      onPositionsChange: (next) => positions.push(next),
    });

    editor.setContent(await render(source));
    expect(document.querySelector("style[data-td-visual-editor]")?.textContent).toBe(VISUAL_EDITOR_CSS);
    expect(container.classList.contains("td-visual-editor")).toBe(true);
    expect(container.querySelectorAll(".td-canvas-toolbar .td-canvas-button")).toHaveLength(8);
    expect(container.querySelectorAll(".td-node-creator .td-node-kind-button")).toHaveLength(3);
    expect(container.querySelectorAll(".td-legend-item")).toHaveLength(3);
    expect(container.querySelector('[data-decl="Profile"]')?.getAttribute("transform")).toBe("translate(16 8)");
    expect(container.querySelectorAll(".td-port").length).toBeGreaterThan(8);
    installVisualEditorStyles(document);
    expect(document.querySelectorAll("style[data-td-visual-editor]")).toHaveLength(1);

    clickNode(container.querySelector<SVGGElement>('[data-decl="State"]'), 50, 50);
    expect(container.querySelector(".td-inspector-kind")?.textContent).toBe("union");
    clickNode(container.querySelector<SVGGElement>('[data-decl="Owner"]'), 50, 50);
    expect(container.querySelector(".td-inspector-kind")?.textContent).toBe("alias");

    const account = container.querySelector<SVGGElement>('[data-decl="Account"]');
    const svg = container.querySelector<SVGSVGElement>("svg");
    expect(account).not.toBeNull();
    expect(svg).not.toBeNull();
    account?.dispatchEvent(pointer("pointerdown", 100, 100));
    svg?.dispatchEvent(pointer("pointermove", 164, 148));
    svg?.dispatchEvent(pointer("pointerup", 164, 148));
    expect(account?.getAttribute("transform")).toBe("translate(56 40)");
    expect(positions.at(-1)?.Account).toEqual({ x: 56, y: 40 });
    expect(container.querySelector(".td-inspector")?.hasAttribute("hidden")).toBe(true);
    account?.dispatchEvent(pointer("pointerdown", 164, 148));
    svg?.dispatchEvent(pointer("pointerup", 164, 148));
    expect(container.querySelector(".td-inspector")?.hasAttribute("hidden")).toBe(false);

    const nameInput = container.querySelector<HTMLInputElement>(".td-inspector input");
    expect(nameInput?.value).toBe("Account");
    switch (nameInput) {
      case null:
        break;
      default:
        nameInput.value = "Workspace";
        nameInput.dispatchEvent(new Event("change"));
    }
    expect(source).toContain("type Workspace");
    expect(source).toContain("account: Workspace");
    editor.setContent(await render(source));

    const workspace = container.querySelector<SVGGElement>('[data-decl="Workspace"]');
    clickNode(workspace, 80, 80);
    const firstRowInputs = container.querySelectorAll<HTMLInputElement>(".td-inspector-row input");
    const firstName = firstRowInputs[0];
    const firstType = firstRowInputs[1];
    switch (firstName) {
      case undefined:
        break;
      default:
        firstName.value = "member";
        firstName.dispatchEvent(new Event("change"));
    }
    switch (firstType) {
      case undefined:
        break;
      default:
        firstType.value = "Option<Profile>";
        firstType.dispatchEvent(new Event("change"));
    }
    expect(source).toContain("member: Option<Profile>");
    container.querySelector<HTMLButtonElement>(".td-inspector-add")?.click();
    expect(source).toContain("field: String");
    editor.setContent(await render(source));

    clickNode(container.querySelector<SVGGElement>('[data-decl="Workspace"]'), 80, 80);
    container.querySelectorAll<HTMLButtonElement>(".td-inspector-remove").item(2).click();
    expect(source).not.toContain("field: String");
    editor.setContent(await render(source));

    const port = container.querySelector<SVGCircleElement>(
      '[data-decl="Workspace"] .td-source-port[data-row-index="0"]'
    );
    const target = container.querySelector<SVGGElement>('[data-decl="Profile"]');
    const connectionSvg = container.querySelector<SVGSVGElement>("svg");
    switch (connectionSvg) {
      case null:
        break;
      default:
        vi.spyOn(connectionSvg, "getScreenCTM").mockReturnValue(null);
    }
    const elementFromPoint = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    port?.dispatchEvent(pointer("pointerdown", 200, 140));
    connectionSvg?.dispatchEvent(pointer("pointermove", 400, 200));
    expect(container.querySelector(".td-connection-preview")?.getAttribute("d")).toContain(" C ");
    connectionSvg?.dispatchEvent(pointer("pointerup", 400, 200));
    expect(source).toContain("member: Profile");
    expect(elementFromPoint).toHaveBeenCalled();

    const wrapper = container.querySelector<HTMLElement>(".viewport-wrapper");
    const beforeZoom = wrapper?.style.transform;
    container.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, clientY: 200, deltaY: -1 })
    );
    expect(wrapper?.style.transform).not.toBe(beforeZoom);
    container.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, clientY: 200, deltaY: 1 })
    );
    container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click();
    container.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')?.click();
    container.querySelector<HTMLButtonElement>('[aria-label="Fit diagram to view"]')?.click();
    container.querySelector<HTMLButtonElement>('[aria-label="Reset canvas"]')?.click();
    expect(wrapper?.style.transform).toBe("translate(0px, 0px) scale(1)");

    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    container.querySelector<HTMLButtonElement>('[aria-label="Export SVG"]')?.click();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(click).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('[aria-label="Restore automatic layout"]')?.click();
    expect(positions.at(-1)).toEqual({});
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.querySelector<HTMLElement>(".td-inspector")?.hidden).toBe(true);
    expect(changes.length).toBeGreaterThanOrEqual(5);
  });

  it("handles bare viewports, invalid edits, cancelled gestures, and missing SVG exports", async () => {
    const bare = document.createElement("div");
    size(bare, 0, 0);
    document.body.appendChild(bare);
    setViewportContent(bare, "<p>diagnostic</p>");
    expect(bare.innerHTML).toBe("<p>diagnostic</p>");

    const viewport = createViewport(bare);
    viewport.zoomIn();
    viewport.zoomOut();
    viewport.fit();
    viewport.reset();
    expect(viewport.scale).toBe(1);
    bare.dispatchEvent(pointer("pointermove", 20, 20));
    const ignored = document.createElement("button");
    bare.appendChild(ignored);
    ignored.dispatchEvent(pointer("pointerdown", 0, 0));
    bare.dispatchEvent(pointer("pointermove", 100, 100));
    bare.dispatchEvent(pointer("pointerdown", 0, 0));
    bare.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    expect(bare.classList.contains("td-is-panning")).toBe(false);

    let source = SOURCE;
    const editor = createVisualEditor(bare, {
      getSource: () => source,
      onSourceChange: (next) => (source = next),
    });
    editor.setContent(await render(source));
    const account = bare.querySelector<SVGGElement>('[data-decl="Account"]');
    const svg = bare.querySelector<SVGSVGElement>("svg");
    account?.dispatchEvent(pointer("pointerdown", 20, 20));
    svg?.dispatchEvent(pointer("pointerup", 20, 20));
    const typeInput = bare.querySelectorAll<HTMLInputElement>(".td-inspector-row input").item(1);
    typeInput.value = "List<";
    typeInput.dispatchEvent(new Event("change"));
    expect(bare.querySelector<HTMLElement>(".td-editor-toast")?.hidden).toBe(false);
    bare.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));

    editor.setContent("<pre>bad source</pre>");
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    bare.querySelector<HTMLButtonElement>('[aria-label="Export SVG"]')?.click();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(bare.querySelector(".viewport-wrapper")?.textContent).toContain("bad source");
  });

  it("keeps the inspector off the canvas while a node drag is in progress", async () => {
    const container = document.createElement("section");
    size(container);
    document.body.appendChild(container);
    const editor = createVisualEditor(container, {
      getSource: () => SOURCE,
      onSourceChange: vi.fn(),
    });
    editor.setContent(await render(SOURCE));
    const account = container.querySelector<SVGGElement>('[data-decl="Account"]');
    const svg = container.querySelector<SVGSVGElement>("svg");
    const inspector = container.querySelector<HTMLElement>(".td-inspector");

    expect(inspector?.hidden).toBe(true);
    account?.dispatchEvent(pointer("pointerdown", 100, 100));
    expect(inspector?.hidden).toBe(true);
    svg?.dispatchEvent(pointer("pointermove", 164, 148));
    expect(inspector?.hidden).toBe(true);
    expect(account?.getAttribute("transform")).toBe("translate(56 40)");
    svg?.dispatchEvent(pointer("pointerup", 164, 148));
    expect(inspector?.hidden).toBe(true);
    account?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(inspector?.hidden).toBe(true);

    account?.dispatchEvent(pointer("pointerdown", 164, 148));
    svg?.dispatchEvent(pointer("pointerup", 164, 148));
    account?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(inspector?.hidden).toBe(false);
    expect(container.querySelector<HTMLInputElement>(".td-inspector input")?.value).toBe("Account");
  });

  it("zooms proportionally for trackpad deltas without slowing toolbar controls", () => {
    const container = document.createElement("section");
    size(container);
    document.body.appendChild(container);
    const viewport = createViewport(container);

    container.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, clientY: 200, deltaY: -1 })
    );
    expect(viewport.scale).toBeGreaterThan(1);
    expect(viewport.scale).toBeLessThan(1.01);

    viewport.reset();
    container.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, clientY: 200, deltaY: -100 })
    );
    expect(viewport.scale).toBeCloseTo(1.12, 5);

    viewport.reset();
    viewport.zoomIn();
    expect(viewport.scale).toBeCloseTo(1.12, 5);
    viewport.zoomOut();
    expect(viewport.scale).toBeCloseTo(1, 5);
  });

  it("renders close and remove actions as accessible icon buttons", async () => {
    const container = document.createElement("section");
    size(container);
    document.body.appendChild(container);
    const editor = createVisualEditor(container, {
      getSource: () => SOURCE,
      onSourceChange: vi.fn(),
    });
    editor.setContent(await render(SOURCE));
    const account = container.querySelector<SVGGElement>('[data-decl="Account"]');
    const svg = container.querySelector<SVGSVGElement>("svg");
    account?.dispatchEvent(pointer("pointerdown", 100, 100));
    svg?.dispatchEvent(pointer("pointerup", 100, 100));

    const close = container.querySelector<HTMLButtonElement>(".td-inspector-close");
    const removes = [...container.querySelectorAll<HTMLButtonElement>(".td-inspector-remove")];
    expect(close?.type).toBe("button");
    expect(close?.classList.contains("td-icon-button")).toBe(true);
    expect(close?.getAttribute("aria-label")).toBe("Close properties");
    expect(close?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(close?.textContent).toBe("");
    expect(removes).toHaveLength(2);
    removes.forEach((button) => {
      expect(button.type).toBe("button");
      expect(button.classList.contains("td-icon-button")).toBe(true);
      expect(button.getAttribute("aria-label")).toBe("Remove row");
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(button.textContent).toBe("");
    });
    expect(VISUAL_EDITOR_CSS).toContain(".td-icon-button{display:inline-grid");
    expect(VISUAL_EDITOR_CSS).toContain("border:1px solid");
    expect(VISUAL_EDITOR_CSS).toContain(".td-icon-button:focus-visible");
  });

  it("adds every ADT node kind and deletes a selected node from the diagram source", async () => {
    const container = document.createElement("section");
    size(container);
    document.body.appendChild(container);
    let source = SOURCE;
    const editor = createVisualEditor(container, {
      getSource: () => source,
      onSourceChange: (next) => {
        source = next;
      },
    });
    editor.setContent(await render(source));

    const addType = container.querySelector<HTMLButtonElement>('[aria-label="Add type"]');
    expect(addType).not.toBeNull();
    addType?.click();
    const creator = container.querySelector<HTMLElement>(".td-node-creator");
    expect(creator?.hidden).toBe(false);
    expect(creator?.querySelectorAll("button")).toHaveLength(3);
    expect(creator?.textContent).toContain("Record");
    expect(creator?.textContent).toContain("Union");
    expect(creator?.textContent).toContain("Alias");

    container.querySelector<HTMLButtonElement>('[aria-label="Add record type"]')?.click();
    expect(source).toContain("type NewRecord");
    expect(source).toContain("field: String");
    addType?.click();
    container.querySelector<HTMLButtonElement>('[aria-label="Add union type"]')?.click();
    expect(source).toContain("union NewUnion");
    expect(source).toContain("Variant");
    addType?.click();
    container.querySelector<HTMLButtonElement>('[aria-label="Add alias type"]')?.click();
    expect(source).toContain("alias NewAlias = String");

    editor.setContent(await render(source));
    expect(container.querySelector('[data-decl="NewRecord"]')).not.toBeNull();
    expect(container.querySelector('[data-decl="NewUnion"]')).not.toBeNull();
    expect(container.querySelector('[data-decl="NewAlias"]')).not.toBeNull();
    const account = container.querySelector<SVGGElement>('[data-decl="Account"]');
    const svg = container.querySelector<SVGSVGElement>("svg");
    account?.dispatchEvent(pointer("pointerdown", 100, 100));
    svg?.dispatchEvent(pointer("pointerup", 100, 100));
    const deleteType = container.querySelector<HTMLButtonElement>(".td-inspector-delete");
    expect(deleteType?.textContent).toContain("Delete type");
    expect(deleteType?.getAttribute("aria-label")).toBe("Delete Account");
    deleteType?.click();
    expect(source).not.toContain("type Account {");
    expect(source).toContain("account: Account");

    editor.setContent(await render(source));
    expect(container.querySelector('[data-decl="Account"]')).toBeNull();
    expect(container.querySelectorAll('[data-edge][data-target="Account"]')).toHaveLength(0);
  });
});
