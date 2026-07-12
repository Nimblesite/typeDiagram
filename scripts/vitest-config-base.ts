// [VITEST-CONFIG-BASE] Shared vitest config factory for every package. Each
// package's vitest.config.ts calls createVitestConfig() with only the values
// that genuinely differ between packages (coverage project key, extra excludes,
// environment, extra reporters, snapshot handling). The common test.include,
// coverage provider, base reporters and source include live here so the four
// package configs no longer duplicate them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

interface ThresholdsFile {
  readonly projects: Record<string, Record<string, number>>;
}

const loadThresholds = (project: string, configDir: string) => {
  const raw: unknown = JSON.parse(readFileSync(resolve(configDir, "../../coverage-thresholds.json"), "utf8"));
  return (raw as ThresholdsFile).projects[project];
};

export interface VitestConfigOptions {
  /** Absolute path of the calling package (pass `__dirname`). */
  readonly configDir: string;
  /**
   * coverage-thresholds.json project key (e.g. "packages/cli"). Omit when the
   * package enforces coverage elsewhere (web merges vitest + Playwright in
   * scripts/merge-coverage.ts, so it must not set vitest thresholds here).
   */
  readonly project?: string;
  /** Package-specific coverage excludes, appended to the shared d.ts exclude. */
  readonly exclude?: readonly string[];
  /** Test environment (web uses "happy-dom"; others use the vitest default). */
  readonly environment?: string;
  /** Extra coverage reporters appended to the shared base reporters. */
  readonly extraReporters?: readonly string[];
  /** Override the coverage reports directory (web writes to "coverage/vitest"). */
  readonly reportsDirectory?: string;
  /** Extra top-level test options (typediagram's snapshot format/path handling). */
  readonly extraTestOptions?: Record<string, unknown>;
}

export const createVitestConfig = (options: VitestConfigOptions) => {
  const thresholds = options.project === undefined ? undefined : loadThresholds(options.project, options.configDir);
  return defineConfig({
    test: {
      ...(options.environment === undefined ? {} : { environment: options.environment }),
      include: ["test/**/*.test.ts"],
      ...(options.extraTestOptions ?? {}),
      coverage: {
        provider: "v8",
        reporter: ["text", "html", "json-summary", ...(options.extraReporters ?? [])],
        ...(options.reportsDirectory === undefined ? {} : { reportsDirectory: options.reportsDirectory }),
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.d.ts", ...(options.exclude ?? [])],
        ...(thresholds === undefined ? {} : { thresholds }),
      },
    },
  });
};
