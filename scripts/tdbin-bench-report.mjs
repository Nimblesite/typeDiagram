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
  "tdbin_decode_bare",
  "tdbin_decode_framed",
  "tdbin_decode_packed_framed",
  "protobuf_decode",
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
    release_mode: "packed framed",
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
      `| \`${row.name}\` | ${row.shape} | ${row.logical_items.toLocaleString()} | ${row.tdbin_bare.toLocaleString()} | ${row.tdbin_framed.toLocaleString()} | ${row.tdbin_packed_framed.toLocaleString()} | ${row.protobuf.toLocaleString()} | ${percent(row.tdbin_framed, row.protobuf)} | ${percent(row.tdbin_packed_framed, row.protobuf)} |`
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

const passCount = modeRows.split("\n").filter((row) => row.endsWith(" PASS |")).length;
const releaseResults = sizes.fixtures.map((fixture) => {
  const encodeRatio = ratio(fixture.name, "tdbin_encode_packed_framed");
  const decodeRatio = ratio(fixture.name, "tdbin_decode_packed_framed");
  return {
    fixture: fixture.name,
    pass:
      fixture.tdbin_packed_framed <= fixture.protobuf &&
      encodeRatio >= data.gate.encode_speed_ratio_min &&
      decodeRatio >= data.gate.decode_speed_ratio_min,
  };
});
const releasePassCount = releaseResults.filter((row) => row.pass).length;
const releaseVerdict = releasePassCount === sizes.fixtures.length ? "PASS" : "FAIL";
const report = `# TDBIN Benchmark Report

> GENERATED FILE. Source: \`scripts/tdbin-bench-report.mjs\` and \`docs/reports/tdbin-bench-data.json\`.
> Every value and verdict is computed from machine-readable Criterion and encoder output. No benchmark result is entered manually.

Generated: ${data.generated_at}

Raw data SHA-256: \`${digest}\`

## Result

**Specification gate: ${releaseVerdict}.** ${releasePassCount} of ${sizes.fixtures.length} fixtures pass the packed-framed size, encode, and decode requirements simultaneously.

The release gate requires packed-framed TDBIN to be no larger than Protobuf and at least ${data.gate.encode_speed_ratio_min.toFixed(2)}x faster for both encode and decode on every fixture.

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

| Fixture | Shape | Items | TDBIN bare | TDBIN framed | TDBIN packed framed | Protobuf | Framed delta | Packed delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${sizeRows}

## Criterion Medians

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
process.stdout.write(`wrote ${dataPath}\nwrote ${reportPath}\n`);
