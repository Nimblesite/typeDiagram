import { createVitestConfig } from "../../scripts/vitest-config-base";

export default createVitestConfig({
  configDir: __dirname,
  project: "packages/typediagram",
  extraTestOptions: {
    snapshotFormat: { printBasicPrototype: false },
    resolveSnapshotPath: (testPath: string, snapExt: string) =>
      testPath.replace(/test\/(.+)\.test\.ts$/, `test/__snapshots__/$1.test.ts${snapExt}`),
  },
});
