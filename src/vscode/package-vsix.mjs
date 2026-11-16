// Package this extension as a VSIX with Marketplace name "typediagram".
// Because the CLI package is also named "typediagram" in the monorepo, we can't
// rename this workspace in place — npm workspaces reject duplicate names.
//
// Strategy: build the extension in-place (vscode:prepublish runs here), then
// stage the built output into a temp directory outside the workspace root,
// rename the staged package.json to "typediagram", and run `vsce package`
// there with a no-op prepublish. Copy the resulting .vsix back.
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const MARKETPLACE_NAME = "typediagram";

const runBuild = spawnSync("node", ["esbuild.mjs", "--production"], {
  cwd: HERE,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (runBuild.status !== 0) {
  console.error(`esbuild failed (status ${runBuild.status})`);
  process.exit(runBuild.status ?? 1);
}

const staging = mkdtempSync(join(tmpdir(), "typediagram-vsix-"));
try {
  cpSync(HERE, staging, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(HERE.length);
      return !rel.startsWith("/node_modules") && !rel.startsWith("/coverage") && !rel.startsWith("/src");
    },
  });

  const pkgPath = join(staging, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = MARKETPLACE_NAME;
  pkg.scripts = { ...(pkg.scripts ?? {}), "vscode:prepublish": "echo skipping prepublish" };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const extraArgs = process.argv.slice(2);
  const result = spawnSync("npx", ["@vscode/vsce", "package", "--no-dependencies", ...extraArgs], {
    cwd: staging,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    console.error(`vsce package failed (status ${result.status})`);
    process.exit(result.status ?? 1);
  }

  for (const name of readdirSync(staging)) {
    if (name.endsWith(".vsix")) cpSync(join(staging, name), join(REPO_ROOT, name));
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
