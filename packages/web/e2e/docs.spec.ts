// [WEB-TDBIN-DOCS-E2E] TDBIN documentation must be discoverable and readable
// in the built site, including the responsive navigation used on small screens.
import { expect, test } from "./support/coverage-fixture.js";

test.describe("[WEB-TDBIN-DOCS]", () => {
  test("ships a linked guide with Rust and TypeScript round-trip examples", async ({ page }) => {
    await page.goto("/docs/tdbin.html");

    await expect(page).toHaveTitle(/TDBIN Binary Codec/);
    await expect(page.getByRole("heading", { name: "TDBIN Binary Codec" })).toBeVisible();
    await expect(page.locator('.docs-mobile-nav a[href="/docs/tdbin.html"]')).toHaveText("TDBIN Binary Codec");
    await expect(page.getByRole("heading", { name: "Rust: encode and decode generated types" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "TypeScript: generate a codec, then round-trip" })).toBeVisible();
    await expect(page.locator("pre code.language-rust").filter({ hasText: "to_bytes" })).toContainText("from_bytes");
    await expect(page.locator("pre code.language-typescript").filter({ hasText: "tdbin.encode" })).toContainText(
      "tdbin.decode"
    );
  });
});
