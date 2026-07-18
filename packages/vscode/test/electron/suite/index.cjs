// [VSCODE-E2E-SUITE] Mocha entry point executed inside the extension host by
// @vscode/test-electron. Discovers and runs test files under this directory.
const path = require("node:path");
const { writeFileSync } = require("node:fs");
const Mocha = require("mocha");
const { glob } = require("glob");
const resultPath =
  process.env.TYPEDIAGRAM_ELECTRON_RESULT_PATH ?? path.resolve(__dirname, "../../../.vscode-test/electron-result.ok");

function run() {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30_000 });
  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    glob("**/*.spec.cjs", { cwd: testsRoot })
      .then((files) => {
        for (const f of files) {
          mocha.addFile(path.resolve(testsRoot, f));
        }
        mocha.run((failures) => {
          if (failures > 0) reject(new Error(`${failures} tests failed.`));
          else {
            writeFileSync(resultPath, "passed\n");
            resolve();
          }
        });
      })
      .catch(reject);
  });
}

module.exports = { run };
