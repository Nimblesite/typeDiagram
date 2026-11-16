// [SWR-VERSION-TEST-REQ] [SWR-VERSION-BUILD-STAMPING] The release stamper must accept an
// arbitrary version, update EVERY carrier in a temp copy, and leave files untouched in
// --dry-run. Black-box: spawns the real script exactly as release.yml does.
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../../src/scripts/stamp-version.mjs", import.meta.url));

const PKG_RELS = [
  "src/typediagram/package.json",
  "src/cli/package.json",
  "src/vscode/package.json",
  "src/web/package.json",
];

const writeFixtureRepo = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "stamp-test-"));
  for (const rel of PKG_RELS) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    const withDep = rel !== "src/typediagram/package.json";
    await writeFile(
      join(root, rel),
      `${JSON.stringify(
        withDep
          ? { name: rel, version: "0.1.0", dependencies: { "typediagram-core": "0.1.0" } }
          : { name: rel, version: "0.1.0" },
        null,
        2
      )}\n`
    );
  }
  await writeFile(
    join(root, "shipwright.json"),
    `${JSON.stringify(
      {
        manifestVersion: 1,
        product: { id: "typediagram", displayName: "typeDiagram", version: "0.1.0" },
        components: [{ id: "typediagram-cli", expectedVersion: "0.1.0" }],
      },
      null,
      2
    )}\n`
  );
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "Cargo.toml"), CARGO_FIXTURE);
  return root;
};

// The real workspace manifest shape: comments, a lint table, and the crate
// version carried by [workspace.package] ([TDBIN-RS-PUBLISH]).
const CARGO_FIXTURE = `# workspace
[workspace]
resolver = "2"
members = ["src/*"]

[workspace.package]
version = "0.1.0"
edition = "2021"

[workspace.lints.clippy]
all = { level = "deny", priority = -1 }
`;

const cargoVersion = async (root: string) => {
  const text = await readFile(join(root, "src", "Cargo.toml"), "utf8");
  const { parse } = await import("smol-toml");
  const doc = parse(text) as { workspace: { package: { version: string }; members: string[] } }; // safety: fixture shape
  return { version: doc.workspace.package.version, members: doc.workspace.members, text };
};

const readJson = async (root: string, rel: string): Promise<unknown> =>
  JSON.parse(await readFile(join(root, rel), "utf8")) as unknown;

describe("[SWR-VERSION-BUILD-STAMPING] stamp-version.mjs", () => {
  it("stamps an arbitrary tag version into every carrier of a temp repo copy", async () => {
    const root = await writeFixtureRepo();
    const { stdout } = await run("node", [SCRIPT, "--tag", "v9.9.9-rc.1", "--root", root]);
    expect(stdout).toContain("stamping 9.9.9-rc.1");
    for (const rel of PKG_RELS) {
      const pkg = (await readJson(root, rel)) as {
        version: string;
        dependencies?: { "typediagram-core": string };
      }; // safety: fixture shape written by this test
      expect(pkg.version).toBe("9.9.9-rc.1");
      expect(pkg.dependencies?.["typediagram-core"] ?? "9.9.9-rc.1").toBe("9.9.9-rc.1");
    }
    const manifest = (await readJson(root, "shipwright.json")) as {
      product: { version: string };
      components: readonly { expectedVersion: string }[];
    }; // safety: fixture shape written by this test
    expect(manifest.product.version).toBe("9.9.9-rc.1");
    expect(manifest.components[0]?.expectedVersion).toBe("9.9.9-rc.1");
    const cargo = await cargoVersion(root);
    expect(cargo.version).toBe("9.9.9-rc.1");
    expect(cargo.members).toEqual(["src/*"]);
    expect(cargo.text).toContain("priority = -1");
    expect(stdout).toContain("[stamp] src/Cargo.toml: workspace.package.version=9.9.9-rc.1");
  });

  it("--dry-run lists every carrier but changes nothing", async () => {
    const root = await writeFixtureRepo();
    const { stdout } = await run("node", [SCRIPT, "--version", "2.0.0", "--root", root, "--dry-run"]);
    for (const rel of PKG_RELS) {
      expect(stdout).toContain(rel);
      const pkg = (await readJson(root, rel)) as { version: string }; // safety: fixture shape written by this test
      expect(pkg.version).toBe("0.1.0");
    }
    expect(stdout).toContain("shipwright.json");
    const manifest = (await readJson(root, "shipwright.json")) as {
      product: { version: string };
    }; // safety: fixture shape written by this test
    expect(manifest.product.version).toBe("0.1.0");
    expect(stdout).toContain("src/Cargo.toml");
    expect((await cargoVersion(root)).text).toBe(CARGO_FIXTURE);
    // Without --root the script must default to the real repo root (release.yml
    // invokes it that way), not src/ — which would resolve src/src/... carriers.
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
    const dflt = await run("node", [SCRIPT, "--version", "2.0.0", "--dry-run"]);
    expect(dflt.stdout).toContain(`stamping 2.0.0 into ${repoRoot}\n`);
    for (const rel of PKG_RELS) {
      expect(dflt.stdout).toContain(`${rel}: version=2.0.0`);
    }
    expect(dflt.stdout).toContain("src/Cargo.toml: workspace.package.version=2.0.0");
  });

  it("rejects a non-semver version with exit 1", async () => {
    const root = await writeFixtureRepo();
    await expect(run("node", [SCRIPT, "--version", "not-a-version", "--root", root])).rejects.toMatchObject({
      code: 1,
    });
  });
});
