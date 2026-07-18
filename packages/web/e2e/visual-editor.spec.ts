// [WEB-VISUAL-EDITOR-E2E] Whole-app canvas editing in a real browser.
import { expect, test } from "./support/coverage-fixture.js";
import type { Locator, Page } from "@playwright/test";

type Point = { x: number; y: number };

const dispatchPointerDrag = async (source: Locator, from: Point, to: Point, releaseSelector?: string) => {
  return source.evaluate(
    (element, points) => {
      const svg = (element as SVGElement).ownerSVGElement;
      const inspector = element.ownerDocument.querySelector<HTMLElement>(".td-inspector");
      const pointer = (type: string, point: Point, buttons: number) =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: "mouse",
          isPrimary: true,
          buttons,
          clientX: point.x,
          clientY: point.y,
        });
      element.dispatchEvent(pointer("pointerdown", points.from, 1));
      const hiddenOnDown = inspector?.hidden === true;
      svg?.dispatchEvent(pointer("pointermove", points.to, 1));
      const hiddenOnMove = inspector?.hidden === true;
      const release = points.releaseSelector === undefined ? svg : element.ownerDocument.querySelector(points.releaseSelector);
      release?.dispatchEvent(pointer("pointerup", points.to, 0));
      return { hiddenOnDown, hiddenOnMove, hiddenOnUp: inspector?.hidden === true };
    },
    { from, to, releaseSelector }
  );
};

const openEditor = async (page: Page) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.waitForSelector('#preview svg [data-decl="ChatRequest"]');
};

test.describe("[WEB-VISUAL-EDITOR]", () => {
  test("edits types directly while dragging nodes, drawing relations, zooming, and preserving layout", async ({
    page,
  }) => {
    await openEditor(page);
    await expect(page.locator("#preview.td-visual-editor")).toHaveCount(1);
    await expect(page.locator(".td-canvas-toolbar .td-canvas-button")).toHaveCount(8);
    await expect(page.locator(".td-canvas-legend .td-legend-item")).toHaveCount(3);
    await expect(page.locator("#preview svg #td-grid")).toHaveCount(1);
    await expect(page.locator("#preview svg #td-ambient-shadow")).toHaveCount(1);

    const canvasBackground = await page
      .locator("#preview")
      .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(canvasBackground).toContain("linear-gradient");
    expect(canvasBackground).toContain("radial-gradient");

    const request = page.locator('[data-decl="ChatRequest"]');
    await request.click();
    await expect(request).toHaveClass(/td-selected/);
    await expect(page.locator(".td-inspector")).toBeVisible();
    await expect(page.locator(".td-inspector-kind")).toHaveText("record");
    await expect(page.getByRole("button", { name: "Close properties" }).locator('svg[aria-hidden="true"]')).toHaveCount(
      1
    );

    const declarationInput = page.locator(".td-inspector input").first();
    await declarationInput.fill("ConversationRequest");
    await declarationInput.blur();
    await expect(page.locator("#editor")).toHaveValue(/type ConversationRequest/);
    await expect(page.locator('[data-decl="ConversationRequest"]')).toHaveCount(1);

    await page.locator('[data-decl="ConversationRequest"]').click();
    const firstFieldName = page.locator(".td-inspector-row").first().locator("input").first();
    await firstFieldName.fill("prompt");
    await firstFieldName.blur();
    const invalidType = page.locator(".td-inspector-row").first().locator("input").nth(1);
    await invalidType.fill("List<");
    await invalidType.blur();
    await expect(page.locator(".td-editor-toast")).toBeVisible();
    await expect(page.locator("#editor")).not.toHaveValue(/prompt: List</);
    const validType = page.locator(".td-inspector-row").first().locator("input").nth(1);
    await validType.fill("Option<String>");
    await validType.blur();
    await expect(page.locator("#editor")).toHaveValue(/prompt: Option<String>/);

    await page.getByRole("button", { name: "Close properties" }).click();
    await page.locator('[data-decl="ToolResultContent"]').click();
    await expect(page.locator(".td-inspector-kind")).toHaveText("union");
    const scalarRow = page.locator(".td-inspector-row").nth(1);
    await scalarRow.locator("input").first().fill("ScalarValue");
    await scalarRow.locator("input").first().blur();
    await page.locator(".td-inspector-row").nth(1).locator("input").nth(1).fill("TextPart");
    await page.locator(".td-inspector-row").nth(1).locator("input").nth(1).blur();
    await expect(page.locator("#editor")).toHaveValue(/ScalarValue \{ value: TextPart \}/);

    await page.getByRole("button", { name: "Close properties" }).click();
    await page.locator('[data-decl="Email"]').click();
    await expect(page.locator(".td-inspector-kind")).toHaveText("alias");
    await page.locator(".td-inspector-row input").nth(1).fill("Option<String>");
    await page.locator(".td-inspector-row input").nth(1).blur();
    await expect(page.locator("#editor")).toHaveValue(/alias Email = Option<String>/);

    await page.getByRole("button", { name: "Close properties" }).click();
    await page.locator('[data-decl="ConversationRequest"]').click();
    const rows = page.locator(".td-inspector-row");
    const beforeAdd = await rows.count();
    await page.locator(".td-inspector-add").click();
    await expect(page.locator("#editor")).toHaveValue(/field: String/);
    await expect(rows).toHaveCount(beforeAdd + 1);
    const beforeRemove = await rows.count();
    await expect(rows.last().locator('.td-inspector-remove svg[aria-hidden="true"]')).toHaveCount(1);
    await expect(rows.last().locator(".td-inspector-remove")).toHaveAttribute("aria-label", "Remove row");
    await rows.last().locator(".td-inspector-remove").click();
    await expect(page.locator(".td-inspector-row")).toHaveCount(beforeRemove - 1);

    const addType = page.getByRole("button", { name: "Add type" });
    await addType.click();
    await expect(page.locator(".td-node-creator")).toBeVisible();
    await expect(page.locator(".td-node-creator button")).toHaveCount(3);
    await page.getByRole("button", { name: "Add record type" }).click();
    await expect(page.locator("#editor")).toHaveValue(/type NewRecord/);
    await expect(page.locator('[data-decl="NewRecord"]')).toHaveCount(1);
    await addType.click();
    await page.getByRole("button", { name: "Add union type" }).click();
    await expect(page.locator("#editor")).toHaveValue(/union NewUnion/);
    await expect(page.locator('[data-decl="NewUnion"]')).toHaveCount(1);
    await addType.click();
    await page.getByRole("button", { name: "Add alias type" }).click();
    await expect(page.locator("#editor")).toHaveValue(/alias NewAlias = String/);
    await expect(page.locator('[data-decl="NewAlias"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Close properties" }).click();
    await page.locator('[data-decl="NewRecord"]').click();
    await expect(page.getByRole("button", { name: "Delete NewRecord" })).toHaveText("Delete type");
    await page.getByRole("button", { name: "Delete NewRecord" }).click();
    await expect(page.locator("#editor")).not.toHaveValue(/type NewRecord/);
    await expect(page.locator('[data-decl="NewRecord"]')).toHaveCount(0);
    await expect(page.locator(".td-inspector")).toBeHidden();

    const movable = page.locator('[data-decl="ConversationRequest"]');
    const movableBox = await movable.boundingBox();
    expect(movableBox).not.toBeNull();
    const centerX = (movableBox?.x ?? 0) + (movableBox?.width ?? 0) / 2;
    const centerY = (movableBox?.y ?? 0) + 12;
    const dragInspector = await dispatchPointerDrag(
      movable,
      { x: centerX, y: centerY },
      { x: centerX + 64, y: centerY + 40 }
    );
    expect(dragInspector).toEqual({ hiddenOnDown: true, hiddenOnMove: true, hiddenOnUp: true });
    const movedPosition = await movable.evaluate((element) => ({
      x: Number((element as SVGGElement).dataset.editorX),
      y: Number((element as SVGGElement).dataset.editorY),
    }));
    expect(movedPosition.x).toBeGreaterThan(0);
    expect(movedPosition.y).toBeGreaterThan(0);
    expect(movedPosition.x % 8).toBe(0);
    expect(movedPosition.y % 8).toBe(0);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("td-playground-positions")))
      .toContain("ConversationRequest");

    const transformBeforeZoom = await page.locator("#preview .viewport-wrapper").getAttribute("style");
    await page.getByRole("button", { name: "Zoom in" }).click();
    const transformAfterZoom = await page.locator("#preview .viewport-wrapper").getAttribute("style");
    expect(transformAfterZoom).not.toBe(transformBeforeZoom);
    await expect(page.locator(".td-zoom-value")).not.toHaveText("100%");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Fit diagram to view" }).click();

    await page.getByRole("button", { name: "Reset canvas" }).click();
    await expect(page.locator(".td-zoom-value")).toHaveText("100%");
    await expect(page.locator("#preview .viewport-wrapper")).toHaveAttribute(
      "style",
      /translate\(0px, 0px\) scale\(1\)/
    );
    await page.locator("#preview").dispatchEvent("wheel", {
      deltaY: -1,
      clientX: 200,
      clientY: 200,
    });
    const trackpadScale = await page.locator("#preview .viewport-wrapper").evaluate((element) => {
      const match = element.style.transform.match(/scale\(([^)]+)\)/);
      return Number(match?.[1] ?? "0");
    });
    expect(trackpadScale).toBeGreaterThan(1);
    expect(trackpadScale).toBeLessThan(1.01);
    await page.getByRole("button", { name: "Reset canvas" }).click();
    await page.locator("#preview").evaluate((element) => {
      const pointer = (type: string, x: number, y: number, buttons: number) =>
        new PointerEvent(type, { bubbles: true, pointerId: 11, clientX: x, clientY: y, buttons });
      element.dispatchEvent(pointer("pointerdown", 12, 18, 1));
      element.dispatchEvent(pointer("pointermove", 62, 53, 1));
      element.dispatchEvent(pointer("pointerup", 62, 53, 0));
    });
    await expect(page.locator("#preview .viewport-wrapper")).toHaveAttribute(
      "style",
      /translate\(50px, 35px\) scale\(1\)/
    );
    await page.getByRole("button", { name: "Reset canvas" }).click();

    const sourcePort = page.locator('[data-decl="ConversationRequest"] .td-source-port[data-row-index="0"]');
    const target = page.locator('[data-decl="AgentConfig"] .td-target-port');
    const sourceBox = await sourcePort.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await dispatchPointerDrag(
      sourcePort,
      { x: (sourceBox?.x ?? 0) + 2, y: (sourceBox?.y ?? 0) + 2 },
      {
        x: (targetBox?.x ?? 0) + (targetBox?.width ?? 0) / 2,
        y: (targetBox?.y ?? 0) + (targetBox?.height ?? 0) / 2,
      },
      '[data-decl="AgentConfig"] .td-target-port'
    );
    await expect(page.locator("#editor")).toHaveValue(/prompt: AgentConfig/);

    await page.getByRole("button", { name: "Restore automatic layout" }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("td-playground-positions"))).toBe("{}");
    expect(
      await page.locator('[data-decl="ConversationRequest"]').evaluate((element) => ({
        x: Number((element as SVGGElement).dataset.editorX),
        y: Number((element as SVGGElement).dataset.editorY),
      }))
    ).toEqual({ x: 0, y: 0 });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export SVG" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("type-diagram.svg");

    await page.locator('[data-decl="ConversationRequest"]').click();
    await page.getByRole("button", { name: "Close properties" }).click();
    await expect(page.locator(".td-inspector")).toBeHidden();
    await page.locator('[data-decl="ConversationRequest"]').click();
    await expect(page.locator("#preview")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".td-inspector")).toBeHidden();
  });
});
