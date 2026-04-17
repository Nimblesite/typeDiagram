// [VSCODE-VSIX-PACKAGE] True VSIX smoke test — builds the extension, packages a .vsix
// via @vscode/vsce, unzips it, and asserts the payload contains:
//   - dist/extension.js (bundled by esbuild)
//   - syntaxes/typediagram.tmLanguage.json
//   - syntaxes/typediagram.markdown-injection.tmLanguage.json
//   - extension manifest with markdown.markdownItPlugins=true and injection grammar
//
// Opt-in behind TYPEDIAGRAM_E2E=1 because packaging spawns vsce (slow, network-aware).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../..");

const RUN_E2E = process.env["TYPEDIAGRAM_E2E"] === "1";
const SUITE = RUN_E2E ? describe : describe.skip;

function buildVsix(): string {
  const result = spawnSync("npm", ["run", "-w", "packages/vscode", "package"], {
    cwd: REPO,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`vsix build failed: ${result.stderr}\n${result.stdout}`);
  }
  const candidates = readdirSync(REPO).filter((f) => /^typediagram-.*\.vsix$/.test(f));
  const latest = candidates.sort().at(-1);
  if (latest === undefined) {
    throw new Error("no .vsix produced");
  }
  return resolve(REPO, latest);
}

function unzipTo(vsix: string, dest: string): void {
  const r = spawnSync("unzip", ["-o", vsix, "-d", dest], { stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`unzip failed: ${r.stderr}`);
  }
}

SUITE("[VSCODE-VSIX-PACKAGE] built VSIX contains required files", () => {
  it("packages a VSIX with grammars, injection, built extension, and contributes markdown plugin", () => {
    const vsix = buildVsix();
    const dest = mkdtempSync(join(tmpdir(), "tdvsix-"));
    try {
      unzipTo(vsix, dest);
      const base = resolve(dest, "extension");
      expect(existsSync(resolve(base, "dist/extension.js"))).toBe(true);
      expect(existsSync(resolve(base, "syntaxes/typediagram.tmLanguage.json"))).toBe(true);
      expect(existsSync(resolve(base, "syntaxes/typediagram.markdown-injection.tmLanguage.json"))).toBe(true);
      const pkg = JSON.parse(readFileSync(resolve(base, "package.json"), "utf8")) as {
        contributes?: { grammars?: unknown[]; "markdown.markdownItPlugins"?: boolean };
      };
      expect(pkg.contributes?.["markdown.markdownItPlugins"]).toBe(true);
      const grammars = pkg.contributes?.grammars as Array<{ scopeName: string }> | undefined;
      expect(grammars?.some((g) => g.scopeName === "markdown.typediagram.codeblock")).toBe(true);
      // Ensure the bundled extension.js is substantial (>50KB minified — includes elk+core).
      const extJs = readFileSync(resolve(base, "dist/extension.js"), "utf8");
      expect(extJs.length).toBeGreaterThan(50_000);
      // String literals that survive minification: command names and markdown refresh command.
      expect(extJs).toContain("typediagram.preview");
      expect(extJs).toContain("markdown.preview.refresh");
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});
