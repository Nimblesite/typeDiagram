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
const SCRIPT = fileURLToPath(new URL("../../../scripts/stamp-version.mjs", import.meta.url));

const PKG_RELS = [
  "packages/typediagram/package.json",
  "packages/cli/package.json",
  "packages/vscode/package.json",
  "packages/web/package.json",
];

const writeFixtureRepo = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "stamp-test-"));
  for (const rel of PKG_RELS) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    const withDep = rel !== "packages/typediagram/package.json";
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
  return root;
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
  });

  it("rejects a non-semver version with exit 1", async () => {
    const root = await writeFixtureRepo();
    await expect(run("node", [SCRIPT, "--version", "not-a-version", "--root", root])).rejects.toMatchObject({
      code: 1,
    });
  });
});
