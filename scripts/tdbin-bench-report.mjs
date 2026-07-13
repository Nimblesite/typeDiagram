import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";

const root = process.cwd();
const target = process.env.CARGO_TARGET_DIR ?? join(root, "target");
const reportPath = join(root, "docs/reports/tdbin-bench-report.md");
const dataPath = join(root, "docs/reports/tdbin-bench-data.json");
const prettierOptions = (await resolveConfig(dataPath)) ?? {};
const operations = [
  "tdbin_encode_bare",
  "tdbin_encode_framed",
  "tdbin_encode_packed_framed",
  "protobuf_encode",
  "msgpack_encode",
  "tdbin_decode_bare",
  "tdbin_decode_framed",
  "tdbin_decode_packed_framed",
  "protobuf_decode",
  "msgpack_decode",
];

const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
const sizes = JSON.parse(run("cargo", ["run", "--quiet", "-p", "tdbin", "--release", "--example", "bench_data"]));

const estimatePath = (fixture, operation) =>
  join(target, "criterion", `tdbin_vs_protobuf_${fixture}`, operation, fixture, "new", "estimates.json");

const samplePath = (fixture, operation) =>
  join(target, "criterion", `tdbin_vs_protobuf_${fixture}`, operation, fixture, "new", "sample.json");

const readEstimate = (fixture, operation) => {
  const parsed = JSON.parse(readFileSync(estimatePath(fixture, operation), "utf8"));
  const sample = JSON.parse(readFileSync(samplePath(fixture, operation), "utf8"));
  return {
    median_ns: parsed.median.point_estimate,
    confidence_interval_ns: [
      parsed.median.confidence_interval.lower_bound,
      parsed.median.confidence_interval.upper_bound,
    ],
    sample_count: sample.times.length,
    sampled_time_ns: sample.times.reduce((total, value) => total + value, 0),
  };
};

const benchmarks = sizes.fixtures.flatMap((fixture) =>
  operations.map((operation) => ({ fixture: fixture.name, operation, ...readEstimate(fixture.name, operation) }))
);

const data = {
  format_version: 1,
  generated_at: new Date().toISOString(),
  commands: ["cargo bench -p tdbin --bench gate -- --noplot", "node scripts/tdbin-bench-report.mjs"],
  corpus_schemas: ["docs/benchmarks/tdbin-corpus.td", "docs/benchmarks/tdbin-corpus.proto"],
  gate: {
    size_ratio_max: 1,
    encode_speed_ratio_min: 1.5,
    decode_speed_ratio_min: 1.5,
    release_mode: "any self-describing production mode (framed or packed framed)",
  },
  environment: {
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    logical_cpus: cpus().length,
    memory_bytes: totalmem(),
    rustc: run("rustc", ["--version"]),
    cargo: run("cargo", ["--version"]),
    dependencies: run("cargo", ["tree", "-p", "tdbin", "--edges", "dev", "--depth", "1"]),
  },
  sizes,
  benchmarks,
};

const canonical = await format(JSON.stringify(data), { ...prettierOptions, filepath: dataPath });
const digest = createHash("sha256").update(canonical).digest("hex");
writeFileSync(dataPath, canonical);

const duration = (nanoseconds) =>
  nanoseconds < 1_000
    ? `${nanoseconds.toFixed(2)} ns`
    : nanoseconds < 1_000_000
      ? `${(nanoseconds / 1_000).toFixed(3)} us`
      : `${(nanoseconds / 1_000_000).toFixed(3)} ms`;

const percent = (value, baseline) => `${(((value - baseline) / baseline) * 100).toFixed(1)}%`;
const estimate = (fixture, operation) =>
  benchmarks.find((row) => row.fixture === fixture && row.operation === operation);
const ratio = (fixture, operation) =>
  estimate(fixture, operation.startsWith("tdbin_encode") ? "protobuf_encode" : "protobuf_decode").median_ns /
  estimate(fixture, operation).median_ns;
const winner = (value, baseline) => (value < baseline ? "TDBIN" : value > baseline ? "Protobuf" : "tie");

const sizeRows = sizes.fixtures
  .map(
    (row) =>
      `| \`${row.name}\` | ${row.shape} | ${row.corpus ? "corpus" : "stress"} | ${row.logical_items.toLocaleString()} | ${row.tdbin_bare.toLocaleString()} | ${row.tdbin_framed.toLocaleString()} | ${row.tdbin_packed_framed.toLocaleString()} | ${row.protobuf.toLocaleString()} | ${row.msgpack.toLocaleString()} | ${percent(row.tdbin_framed, row.protobuf)} | ${percent(row.tdbin_packed_framed, row.protobuf)} |`
  )
  .join("\n");

const timingRows = benchmarks
  .map(
    (row) =>
      `| \`${row.fixture}\` | \`${row.operation}\` | ${row.sample_count} | ${duration(row.sampled_time_ns)} | ${duration(row.median_ns)} | ${duration(row.confidence_interval_ns[0])} | ${duration(row.confidence_interval_ns[1])} |`
  )
  .join("\n");

const modeRows = sizes.fixtures
  .flatMap((fixture) =>
    [
      ["bare", fixture.tdbin_bare, "tdbin_encode_bare", "tdbin_decode_bare"],
      ["framed", fixture.tdbin_framed, "tdbin_encode_framed", "tdbin_decode_framed"],
      ["packed framed", fixture.tdbin_packed_framed, "tdbin_encode_packed_framed", "tdbin_decode_packed_framed"],
    ].map(([mode, bytes, encode, decode]) => {
      const encodeRatio = ratio(fixture.name, encode);
      const decodeRatio = ratio(fixture.name, decode);
      const sizePass = bytes <= fixture.protobuf;
      const gate = sizePass && encodeRatio >= 1.5 && decodeRatio >= 1.5 ? "PASS" : "FAIL";
      return `| \`${fixture.name}\` | ${mode} | ${winner(bytes, fixture.protobuf)} | ${encodeRatio.toFixed(2)}x | ${decodeRatio.toFixed(2)}x | ${gate} |`;
    })
  )
  .join("\n");

// [TDBIN-BENCH-PIVOT] The three self-describing formats compared like-for-like.
// `tdbin` uses the framed wire mode — the production peer of msgpack
// (struct-as-map) and Protobuf. The detailed multi-mode tables below retain
// TDBIN bare/framed/packed and every Criterion statistic.
const median = (fixture, operation) => estimate(fixture, operation).median_ns;
const protocols = [
  {
    label: "tdbin (framed)",
    size: (f) => f.tdbin_framed,
    encode: "tdbin_encode_framed",
    decode: "tdbin_decode_framed",
  },
  { label: "protobuf", size: (f) => f.protobuf, encode: "protobuf_encode", decode: "protobuf_decode" },
  { label: "msgpack", size: (f) => f.msgpack, encode: "msgpack_encode", decode: "msgpack_decode" },
];
// [TDBIN-BENCH-ROUNDTRIP] One row per test: all three formats' sizes, then all
// three formats' serialize/deserialize speeds, straight from the measured data.
const roundTripRows = sizes.fixtures
  .map((fixture) => {
    const size = (p) => p.size(fixture).toLocaleString();
    const enc = (p) => duration(median(fixture.name, p.encode));
    const dec = (p) => duration(median(fixture.name, p.decode));
    const [td, pb, mp] = protocols;
    return `| \`${fixture.name}\` | ${size(td)} | ${size(pb)} | ${size(mp)} | ${enc(td)} | ${enc(pb)} | ${enc(mp)} | ${dec(td)} | ${dec(pb)} | ${dec(mp)} |`;
  })
  .join("\n");

const passCount = modeRows.split("\n").filter((row) => row.endsWith(" PASS |")).length;
const modeQualifies = (fixture, bytes, encodeOp, decodeOp) =>
  bytes <= fixture.protobuf &&
  ratio(fixture.name, encodeOp) >= data.gate.encode_speed_ratio_min &&
  ratio(fixture.name, decodeOp) >= data.gate.decode_speed_ratio_min;
const releaseResults = sizes.fixtures.map((fixture) => {
  const framed = modeQualifies(fixture, fixture.tdbin_framed, "tdbin_encode_framed", "tdbin_decode_framed");
  const packed = modeQualifies(
    fixture,
    fixture.tdbin_packed_framed,
    "tdbin_encode_packed_framed",
    "tdbin_decode_packed_framed"
  );
  return {
    fixture: fixture.name,
    corpus: fixture.corpus,
    mode: packed && framed ? "framed & packed framed" : packed ? "packed framed" : framed ? "framed" : "none",
    pass: framed || packed,
  };
});
const corpusResults = releaseResults.filter((row) => row.corpus);
const stressResults = releaseResults.filter((row) => !row.corpus);
const corpusPassCount = corpusResults.filter((row) => row.pass).length;
const stressPassCount = stressResults.filter((row) => row.pass).length;
const releaseVerdict = corpusPassCount === corpusResults.length ? "PASS" : "FAIL";
const report = `# TDBIN Benchmark Report

> GENERATED FILE. Source: \`scripts/tdbin-bench-report.mjs\` and \`docs/reports/tdbin-bench-data.json\`.
> Every value and verdict is computed from machine-readable Criterion and encoder output. No benchmark result is entered manually.

Generated: ${data.generated_at}

Raw data SHA-256: \`${digest}\`

## Result

**Specification gate ([TDBIN-BENCH-CORPUS] committed workloads): ${releaseVerdict}.** ${corpusPassCount} of ${corpusResults.length} corpus fixtures have a production wire mode that is simultaneously smaller than Protobuf AND at least ${data.gate.encode_speed_ratio_min.toFixed(2)}x faster on both encode and decode. Stress rows: ${stressPassCount} of ${stressResults.length} pass the same bar.

Qualifying modes: ${releaseResults.map((row) => "`" + row.fixture + "` = " + row.mode).join(", ")}.

The release gate ([TDBIN-BENCH-GATE]) requires, for every corpus entry — the committed realistic schemas in \`docs/benchmarks/tdbin-corpus.{td,proto}\` (record-heavy document, union-heavy event stream, list-heavy dataset) — that at least one self-describing production wire mode (framed, or packed framed; the frame's PACKED flag makes the two interchangeable to every decoder) beats Protobuf on size and by ${data.gate.encode_speed_ratio_min.toFixed(2)}x on both encode and decode simultaneously. Both modes are always measured and published below. Stress rows (marked) are reported against the identical bar; the tiny single-message rows carry a fixed 12-byte frame plus pointer-per-string overhead that no fixed-layout format recovers at sub-100-byte payloads (research §2.2), so they are not corpus entries.

## Size and Speed

The headline comparison — one row per test, all three self-describing formats side by side. TDBIN is its **framed** production mode; MessagePack is struct-as-map (via \`rmp-serde\`). Sizes are bytes; serialize is the full ADT→binary conversion, deserialize the full binary→ADT conversion. Lower is better everywhere.

| Test | typeDiagram Size | Protobuf Size | MessagePack Size | typeDiagram Serialize | Protobuf Serialize | MessagePack Serialize | typeDiagram Deserialize | Protobuf Deserialize | MessagePack Deserialize |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${roundTripRows}

## Environment

| Field | Value |
| --- | --- |
| Platform | ${data.environment.platform} ${data.environment.release} (${data.environment.architecture}) |
| CPU | ${data.environment.cpu} |
| Logical CPUs | ${data.environment.logical_cpus} |
| Memory | ${(data.environment.memory_bytes / 1_073_741_824).toFixed(1)} GiB |
| Rust | ${data.environment.rustc} |
| Cargo | ${data.environment.cargo} |

Dependency tree:

\`\`\`text
${data.environment.dependencies}
\`\`\`

## Encoded Size

All sizes are bytes. Percentage columns are relative to Protobuf; negative is smaller.

| Fixture | Shape | Role | Items | TDBIN bare | TDBIN framed | TDBIN packed framed | Protobuf | MessagePack | Framed delta | Packed delta |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${sizeRows}

## Criterion Medians

Each row is one **individual** operation — a complete serialize *or* deserialize, not a round-trip. The operation name encodes the direction (\`encode\` = ADT→binary, \`decode\` = binary→ADT) and the wire mode (\`bare\`, \`framed\`, or \`packed_framed\` for TDBIN). "Median" is the per-call time (what to compare); "Sampled time" is only Criterion's total measurement budget for that row. Sum a fixture's \`encode\` and \`decode\` rows to get the round-trip totals above.

| Fixture | Operation | Samples | Sampled time | Median | CI lower | CI upper |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${timingRows}

## Same-Mode Comparison

Ratios are Protobuf median / TDBIN median; values above 1.00x favor TDBIN. The gate requires size no larger than Protobuf and both encode and decode ratios at least 1.50x.

| Fixture | TDBIN mode | Size winner | Encode ratio | Decode ratio | Gate |
| --- | --- | --- | ---: | ---: | --- |
${modeRows}

Passing fixture/mode combinations: ${passCount} of ${sizes.fixtures.length * 3}.

This secondary table exposes unpacked tradeoffs; it does not replace the packed-framed specification gate above.

## Commands

${data.commands.map((command) => `- \`${command}\``).join("\n")}

Corpus schemas:

${data.corpus_schemas.map((path) => `- \`${path}\``).join("\n")}
`;

writeFileSync(reportPath, await format(report, { ...prettierOptions, filepath: reportPath }));

// [TDBIN-BENCH-WEBSITE] Simplified, reader-facing benchmark page for the docs
// site. Same measured JSON as the full report — never hand-typed — but reduced
// to the committed corpus workloads: a plain three-way comparison of the raw
// measured size and whole-operation speed for each format, with no deltas or
// ratios. Serialize = the full ADT→binary encode; deserialize = the full
// binary→ADT decode; round-trip = the two summed (encode + decode).
const websitePath = join(root, "docs/specs/tdbin-benchmarks.md");
const repo = "https://github.com/Nimblesite/typeDiagram";
const ref = "blob/main";

// [TDBIN-BENCH-WEBSITE-FACTS] Story lines derived strictly from the measured
// data — every claim is a comparison the table already prints, never a guess.
const round1 = (x) => Math.round(x * 10) / 10;
const compareSize = (fixture) => ({
  tdVsPb: round1(fixture.protobuf / fixture.tdbin_framed),
  tdVsMp: round1(fixture.msgpack / fixture.tdbin_framed),
});
const roundTrip = (fixture, p) => median(fixture.name, p.encode) + median(fixture.name, p.decode);
const [td, pb, mp] = protocols;
const factLines = sizes.fixtures.map((fixture) => {
  const s = compareSize(fixture);
  const rtTd = roundTrip(fixture, td);
  const rtPb = roundTrip(fixture, pb);
  const rtMp = roundTrip(fixture, mp);
  const smallest = [
    ["typeDiagram", fixture.tdbin_framed],
    ["Protobuf", fixture.protobuf],
    ["MessagePack", fixture.msgpack],
  ].sort((a, b) => a[1] - b[1])[0][0];
  const fastest = [
    ["typeDiagram", rtTd],
    ["Protobuf", rtPb],
    ["MessagePack", rtMp],
  ].sort((a, b) => a[1] - b[1])[0][0];
  const items = `${fixture.logical_items.toLocaleString()} item${fixture.logical_items === 1 ? "" : "s"}`;
  return `- **\`${fixture.name}\`** (${fixture.shape}, ${items}): smallest encoding is **${smallest}**; fastest round-trip is **${fastest}**. typeDiagram's encoding is ${s.tdVsPb}× the size of Protobuf and ${s.tdVsMp}× the size of MessagePack here (values <1 mean typeDiagram is smaller, >1 larger).`;
});

const mainRows = sizes.fixtures
  .map((fixture) => {
    const size = (p) => p.size(fixture).toLocaleString();
    const enc = (p) => duration(median(fixture.name, p.encode));
    const dec = (p) => duration(median(fixture.name, p.decode));
    return `| \`${fixture.name}\` | ${size(td)} | ${size(pb)} | ${size(mp)} | ${enc(td)} | ${enc(pb)} | ${enc(mp)} | ${dec(td)} | ${dec(pb)} | ${dec(mp)} |`;
  })
  .join("\n");

const website = `# TDBIN Benchmarks

TDBIN is typeDiagram's compact binary codec for algebraic data types, measured here against **Protocol Buffers** and **MessagePack**. Every number below is data-derived — produced by [\`scripts/tdbin-bench-report.mjs\`](${repo}/${ref}/scripts/tdbin-bench-report.mjs) from Criterion timings and exact encoder output — and regenerates on each benchmark run.

## Size and Speed

One row per test. Sizes are exact encoded bytes; "Serialize" is the whole ADT→binary conversion and "Deserialize" the whole binary→ADT conversion, each a Criterion median. typeDiagram is its **framed** production wire mode; MessagePack is struct-as-map (via \`rmp-serde\`). Lower is better in every column.

| Test | typeDiagram Size | Protobuf Size | MessagePack Size | typeDiagram Serialize | Protobuf Serialize | MessagePack Serialize | typeDiagram Deserialize | Protobuf Deserialize | MessagePack Deserialize |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${mainRows}

## What the numbers show

The following are read directly off the table above — each is a comparison of the measured values, nothing more:

${factLines.join("\n")}

## Methodology

- **Same values, three encoders.** Every test builds one logical value and feeds the identical value to the typeDiagram codec, to a hand-written Protobuf mirror (\`prost\`), and — via \`serde\` derives on that same mirror — to MessagePack (\`rmp-serde\`). No format receives a different input. See the fixtures in [\`crates/tdbin/tests/support/bench_corpus.rs\`](${repo}/${ref}/crates/tdbin/tests/support/bench_corpus.rs).
- **Self-describing modes only.** typeDiagram *framed*, Protobuf, and MessagePack *struct-as-map* all carry enough structure to be decoded without an external schema, so the comparison is like-for-like.
- **Sizes are exact byte counts** emitted by each encoder (see [\`crates/tdbin/examples/bench_data.rs\`](${repo}/${ref}/crates/tdbin/examples/bench_data.rs)) — not estimates.
- **Timings are Criterion medians** over ${data.benchmarks[0]?.sample_count ?? 50} samples per operation; each measured value flows through \`black_box\` so the optimizer cannot elide the work. The benchmark harness is [\`crates/tdbin/benches/gate.rs\`](${repo}/${ref}/crates/tdbin/benches/gate.rs).
- **Corpus schemas** are committed at [\`docs/benchmarks/tdbin-corpus.td\`](${repo}/${ref}/docs/benchmarks/tdbin-corpus.td) and [\`docs/benchmarks/tdbin-corpus.proto\`](${repo}/${ref}/docs/benchmarks/tdbin-corpus.proto).

## Test machine

| Field | Value |
| --- | --- |
| Platform | ${data.environment.platform} ${data.environment.release} (${data.environment.architecture}) |
| CPU | ${data.environment.cpu} |
| Logical CPUs | ${data.environment.logical_cpus} |
| Memory | ${(data.environment.memory_bytes / 1_073_741_824).toFixed(1)} GiB |
| Rust | ${data.environment.rustc} |
| Cargo | ${data.environment.cargo} |

## Reproduce

Run the benchmark, then regenerate this page:

${data.commands.map((command) => `- \`${command}\``).join("\n")}
`;

writeFileSync(websitePath, await format(website, { ...prettierOptions, filepath: websitePath }));
process.stdout.write(`wrote ${dataPath}\nwrote ${reportPath}\nwrote ${websitePath}\n`);
