import { createVitestConfig } from "../scripts/vitest-config-base";

export default createVitestConfig({
  configDir: __dirname,
  project: "src/vscode",
  exclude: ["src/webview/**"],
});
