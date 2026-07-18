// [VSCODE-E2E-ELECTRON] Runner: launches a real VS Code via @vscode/test-electron,
// installs the locally-built VSIX, and executes the test suite under Mocha inside
// the extension host. Invoked by `npm run -w packages/vscode test:electron`.
// Kept as plain ESM (.mjs) so we don't need a TS runtime step for the launcher.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync, rmSync, mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PKG_ROOT, "../..");
const RUN_ID = `${String(process.pid)}-${String(Date.now())}`;
const RESULT_PATH = resolve(PKG_ROOT, `.vscode-test/electron-result-${RUN_ID}.ok`);
const HARNESS_PATH = resolve(__dirname, "harness");
const PROFILE_PATH = resolve(PKG_ROOT, `.vscode-test/vsix-profile-${RUN_ID}`);
const USER_DATA_PATH = resolve(PROFILE_PATH, "user-data");
const EXTENSIONS_PATH = resolve(PROFILE_PATH, "extensions");

function findLatestVsix() {
  const files = readdirSync(REPO_ROOT).filter((f) => /^typediagram-.*\.vsix$/.test(f));
  if (files.length === 0) {
    throw new Error("no .vsix found in repo root — run `npm run -w packages/vscode package` first");
  }
  const artifacts = files.map((file) => resolve(REPO_ROOT, file));
  return artifacts.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
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

function runNpm(args, failure) {
  const result = spawnSync("npm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`${failure} (status ${result.status})`);
}

function installVsix(vscodeExecutablePath, configuredCli, appPath, vsixPath) {
  const appCli = appPath === undefined ? undefined : resolve(appPath, "Contents/Resources/app/bin/code");
  const cli = configuredCli
    ? [vscodeExecutablePath]
    : appCli === undefined
      ? resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath)
      : [appCli];
  const result = spawnSync(
    cli[0],
    [
      ...cli.slice(1),
      `--user-data-dir=${USER_DATA_PATH}`,
      `--extensions-dir=${EXTENSIONS_PATH}`,
      "--install-extension",
      vsixPath,
      "--force",
    ],
    { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" }
  );
  if (result.status !== 0) throw new Error(`VSIX installation failed (status ${result.status})`);
}

async function main() {
  checkPlatform();
  runNpm(["run", "-w", "typediagram-core", "build"], "core build failed");
  runNpm(["run", "-w", "packages/vscode", "package"], "VSIX packaging failed");
  const vsixPath = findLatestVsix();
  const extensionTestsPath = resolve(__dirname, "suite/index.cjs");

  // [ELECTRON-DARWIN-WORKAROUND] Pre-download VS Code so we get a concrete executable
  // path. runTests() forwards launchArgs after --extensionDevelopmentPath etc., which
  // on Apple Silicon's "Electron" binary fails because we need the "code" entrypoint.
  // By calling downloadAndUnzipVSCode() + passing the executable path explicitly,
  // @vscode/test-electron routes arguments through the correct launcher.
  const appPath = process.env["TYPEDIAGRAM_VSCODE_APP_PATH"];
  const configuredExecutable = process.env["TYPEDIAGRAM_VSCODE_EXECUTABLE_PATH"];
  const configuredCli = configuredExecutable?.endsWith("/bin/code") === true;
  const vscodeExecutablePath =
    appPath === undefined ? (configuredExecutable ?? (await downloadAndUnzipVSCode())) : "/usr/bin/open";
  rmSync(PROFILE_PATH, { recursive: true, force: true });
  mkdirSync(USER_DATA_PATH, { recursive: true });
  mkdirSync(EXTENSIONS_PATH, { recursive: true });
  installVsix(configuredExecutable ?? vscodeExecutablePath, configuredCli, appPath, vsixPath);
  const profileArgs = [`--user-data-dir=${USER_DATA_PATH}`, `--extensions-dir=${EXTENSIONS_PATH}`];
  const launchArgs =
    appPath === undefined
      ? configuredCli
        ? ["--wait", "--new-window", ...profileArgs]
        : profileArgs
      : ["-W", "-n", "-a", appPath, "--args", ...profileArgs];
  rmSync(RESULT_PATH, { force: true });

  const exitCode = await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: HARNESS_PATH,
    extensionTestsPath,
    extensionTestsEnv: { TYPEDIAGRAM_ELECTRON_RESULT_PATH: RESULT_PATH },
    ...(launchArgs === undefined ? {} : { launchArgs }),
  });
  existsSync(RESULT_PATH)
    ? undefined
    : (() => {
        throw new Error("VS Code exited without completing the Electron suite");
      })();
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
