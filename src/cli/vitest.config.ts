import { createVitestConfig } from "../scripts/vitest-config-base";

export default createVitestConfig({
  configDir: __dirname,
  project: "src/cli",
  exclude: ["src/bin.ts", "src/typeshed-bin.ts"],
});
