// [VSCODE-VSIX-CONTRIBUTES] Structural proof that the extension's package.json declares
// the markdown-it plugin + grammar injection correctly AND that the files those
// contributions point to actually exist on disk. Fast; runs every test invocation.
//
// For a true "build the .vsix and unzip it" smoke test, see vsix-package.test.ts
// which is opt-in via TYPEDIAGRAM_E2E=1 (slow — spawns @vscode/vsce).
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

interface Grammar {
  language?: string;
  scopeName: string;
  path: string;
  injectTo?: string[];
  embeddedLanguages?: Record<string, string>;
}
interface Manifest {
  contributes?: {
    grammars?: Grammar[];
    languages?: Array<{ id: string }>;
    commands?: Array<{ command: string }>;
    "markdown.markdownItPlugins"?: boolean;
  };
  main?: string;
}

function loadManifest(): Manifest {
  const raw = readFileSync(resolve(PKG_ROOT, "package.json"), "utf8");
  return JSON.parse(raw) as Manifest;
}

describe("[VSCODE-VSIX-CONTRIBUTES] package.json declares required contributions", () => {
  it("declares the typediagram language grammar", () => {
    const pkg = loadManifest();
    const grammars = pkg.contributes?.grammars ?? [];
    const lang = grammars.find((g) => g.language === "typediagram");
    expect(lang).toBeDefined();
    if (!lang) {
      return;
    }
    expect(lang.scopeName).toBe("source.typediagram");
    expect(existsSync(resolve(PKG_ROOT, lang.path))).toBe(true);
  });

  it("declares the markdown injection grammar", () => {
    const pkg = loadManifest();
    const grammars = pkg.contributes?.grammars ?? [];
    const injection = grammars.find((g) => g.scopeName === "markdown.typediagram.codeblock");
    expect(injection).toBeDefined();
    if (!injection) {
      return;
    }
    expect(injection.injectTo).toContain("text.html.markdown");
    expect(injection.embeddedLanguages).toEqual({ "meta.embedded.block.typediagram": "typediagram" });
    expect(existsSync(resolve(PKG_ROOT, injection.path))).toBe(true);
  });

  it("enables the markdown-it plugin contribution", () => {
    const pkg = loadManifest();
    expect(pkg.contributes?.["markdown.markdownItPlugins"]).toBe(true);
  });

  it("points main at a valid built extension entry (after build)", () => {
    const pkg = loadManifest();
    expect(pkg.main).toBe("./dist/extension.js");
    // Don't assert existence here — build is a separate step. The vsix-package
    // E2E test asserts the packaged artifact includes this file.
  });

  it("grammar files are valid JSON", () => {
    const pkg = loadManifest();
    const grammars = pkg.contributes?.grammars ?? [];
    for (const g of grammars) {
      const path = resolve(PKG_ROOT, g.path);
      const raw = readFileSync(path, "utf8");
      expect(() => JSON.parse(raw) as unknown).not.toThrow();
      const parsed = JSON.parse(raw) as { scopeName?: string };
      expect(parsed.scopeName).toBe(g.scopeName);
    }
  });
});
