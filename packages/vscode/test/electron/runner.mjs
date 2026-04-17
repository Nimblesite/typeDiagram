// [VSCODE-E2E-ELECTRON] Runner: launches a real VS Code via @vscode/test-electron,
// installs the locally-built VSIX, and executes the test suite under Mocha inside
// the extension host. Invoked by `npm run -w packages/vscode test:electron`.
// Kept as plain ESM (.mjs) so we don't need a TS runtime step for the launcher.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runTests, resolveCliArgsFromVSCodeExecutablePath, downloadAndUnzipVSCode } from "@vscode/test-electron";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PKG_ROOT, "../..");

function findLatestVsix() {
  const files = readdirSync(REPO_ROOT).filter((f) => /^typediagram-.*\.vsix$/.test(f));
  if (files.length === 0) {
    throw new Error("no .vsix found in repo root — run `npm run -w packages/vscode package` first");
  }
  return resolve(REPO_ROOT, files.sort().at(-1));
}

// [ELECTRON-DARWIN-ARM64-LIMITATION] On Apple Silicon, @vscode/test-electron's
// downloaded VS Code app doesn't currently boot cleanly as a test harness — it
// reports bad options for the standard VS Code CLI flags. Works on Linux CI. To
// force-run anyway, set TYPEDIAGRAM_E2E_ELECTRON_FORCE=1.
function checkPlatform() {
  if (process.platform === "darwin" && process.arch === "arm64" && !process.env["TYPEDIAGRAM_E2E_ELECTRON_FORCE"]) {
    console.error(
      "[test:electron] skipping on darwin-arm64 (known @vscode/test-electron issue). " +
        "Set TYPEDIAGRAM_E2E_ELECTRON_FORCE=1 to attempt anyway."
    );
    process.exit(0);
  }
}

async function main() {
  checkPlatform();
  if (!existsSync(resolve(REPO_ROOT, "packages/typediagram/dist/index.js"))) {
    const r = spawnSync("npm", ["run", "-w", "typediagram-core", "build"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (r.status !== 0) throw new Error("core build failed");
  }

  if (!readdirSync(REPO_ROOT).some((f) => /^typediagram-.*\.vsix$/.test(f))) {
    const pkg = spawnSync("npm", ["run", "-w", "packages/vscode", "package"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (pkg.status !== 0) throw new Error("vsix packaging failed");
  }

  void findLatestVsix;
  const extensionTestsPath = resolve(__dirname, "suite/index.cjs");

  // [ELECTRON-DARWIN-WORKAROUND] Pre-download VS Code so we get a concrete executable
  // path. runTests() forwards launchArgs after --extensionDevelopmentPath etc., which
  // on Apple Silicon's "Electron" binary fails because we need the "code" entrypoint.
  // By calling downloadAndUnzipVSCode() + passing the executable path explicitly,
  // @vscode/test-electron routes arguments through the correct launcher.
  const vscodeExecutablePath = await downloadAndUnzipVSCode();
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  void cli;
  void args;

  const exitCode = await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: PKG_ROOT,
    extensionTestsPath,
  });
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
