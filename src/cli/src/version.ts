// [SWR-VERSION-CLI-OUTPUT] [SWR-VERSION-JSON-OUTPUT] CLI version contract.
// The version derives from package.json (package metadata) — never a hard-coded string.
import { createRequire } from "node:module";
import type { Result } from "./result.js";
import { err, ok } from "./result.js";

export interface VersionError {
  readonly message: string;
}

/** Loads the raw package.json object. Injectable so failure paths are testable. */
export type PkgLoader = () => unknown;

const defaultLoader: PkgLoader = () => createRequire(import.meta.url)("../package.json");

const hasVersion = (v: unknown): v is { version: string } =>
  typeof v === "object" && v !== null && "version" in v && typeof v.version === "string";

const readPkgVersion = (load: PkgLoader): Result<string, VersionError> => {
  try {
    const raw = load();
    return hasVersion(raw) ? ok(raw.version) : err({ message: "package.json has no version field" });
  } catch (e) {
    return err({ message: `cannot read package.json: ${String(e)}` });
  }
};

export const versionText = (load: PkgLoader = defaultLoader): Result<string, VersionError> => {
  const v = readPkgVersion(load);
  return v.ok ? ok(`typediagram ${v.value}`) : v;
};

export const versionJson = (load: PkgLoader = defaultLoader): Result<string, VersionError> => {
  const v = readPkgVersion(load);
  return v.ok
    ? ok(
        JSON.stringify({
          manifestVersion: 1,
          name: "typediagram",
          version: v.value,
          kind: "cli",
          language: "typescript",
        })
      )
    : v;
};
