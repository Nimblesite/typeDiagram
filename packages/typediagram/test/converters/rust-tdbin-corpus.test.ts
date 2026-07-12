// [CONV-RUST-TDBIN] Drift guards for the committed columnar (layout major 2)
// benchmark-corpus crate modules: each must equal fresh
// `generateRustModule(model, { layout: 2 })` output ([TDBIN-COL-POLICY]), so a
// codegen change that alters the emitted columnar codecs fails here until the
// modules are regenerated.
// [TDBIN-RS-CRATE] [TDBIN-MSG-STREAM] traced via the generated corpus modules.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { expectRustModuleReproduces } from "./helpers.js";

// The EXACT schema committed to crates/tdbin/tests/generated_batches/mod.rs;
// scripts/tdbin-regen-fixtures.mjs reads this SAME file, so drift guard and
// regeneration can never disagree about the source of truth.
const BATCHES_TD = readFileSync(fileURLToPath(new URL("fixtures/batches.td", import.meta.url)), "utf8");

describe("[CONV-RUST-TDBIN] layout-2 corpus drift guards vs the committed crate modules", () => {
  it("reproduces generated_corpus/mod.rs from docs/benchmarks/tdbin-corpus.td", () => {
    const corpusTd = readFileSync(
      fileURLToPath(new URL("../../../../docs/benchmarks/tdbin-corpus.td", import.meta.url)),
      "utf8"
    );
    expectRustModuleReproduces(corpusTd, "../../../../crates/tdbin/tests/generated_corpus/mod.rs", { layout: 2 });
  });

  it("reproduces generated_batches/mod.rs from the inline PersonBatch/ContactBatch schema", () => {
    expectRustModuleReproduces(BATCHES_TD, "../../../../crates/tdbin/tests/generated_batches/mod.rs", { layout: 2 });
  });
});
