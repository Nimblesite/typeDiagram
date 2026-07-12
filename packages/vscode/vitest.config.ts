import { createVitestConfig } from "../../scripts/vitest-config-base";

export default createVitestConfig({
  configDir: __dirname,
  project: "packages/vscode",
  exclude: ["src/webview/**"],
});
