// [TYPESHED-CORPUS] Reproducible full-checkout conversion and DSL round-trip gate.
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { typeshed } from "../dist/converters/typeshed.js";
import { buildModel } from "../dist/model/build.js";
import { printSource } from "../dist/model/print.js";
import { parse } from "../dist/parser/parser.js";

const listStubs = async (root) => {
  const trees = [join(root, "stdlib"), join(root, "stubs")];
  const entries = await Promise.all(trees.map((tree) => readdir(tree, { recursive: true })));
  return entries.flatMap((names, index) =>
    names.filter((name) => name.endsWith(".pyi")).map((name) => join(trees[index], name))
  );
};

const roundTrips = (model) => {
  const parsed = parse(printSource(model));
  return parsed.ok && buildModel(parsed.value).ok;
};

const auditFile = async (path) => {
  const analyzed = typeshed.analyzeSource(await readFile(path, "utf8"));
  const empty =
    !analyzed.ok && analyzed.error.every((diagnostic) => diagnostic.message === "No typeshed declarations found");
  return !analyzed.ok
    ? { kind: empty ? "empty" : "error", declarations: 0, methods: 0, roundTrip: empty }
    : {
        kind: "eligible",
        declarations: analyzed.value.stats.declarationsConverted,
        methods: analyzed.value.stats.methodsSkipped,
        roundTrip: roundTrips(analyzed.value.model),
      };
};

const buildReport = (outcomes) => {
  const eligible = outcomes.filter((outcome) => outcome.kind === "eligible");
  const roundTrips = eligible.filter((outcome) => outcome.roundTrip).length;
  return {
    files: outcomes.length,
    eligibleFiles: eligible.length,
    emptyFiles: outcomes.filter((outcome) => outcome.kind === "empty").length,
    errorFiles: outcomes.filter((outcome) => outcome.kind === "error").length,
    roundTrips,
    eligibleFileCoverage: eligible.length === 0 ? 0 : roundTrips / eligible.length,
    declarationsConverted: eligible.reduce((total, outcome) => total + outcome.declarations, 0),
    methodsSkipped: eligible.reduce((total, outcome) => total + outcome.methods, 0),
  };
};

const rootArg = process.argv[2];
const root = rootArg === undefined ? undefined : resolve(rootArg);
const outcomes = root === undefined ? undefined : await Promise.all((await listStubs(root)).map(auditFile));
const report = outcomes === undefined ? undefined : buildReport(outcomes);
process.stdout.write(
  report === undefined ? "usage: npm run test:typeshed -- <typeshed-root>\n" : `${JSON.stringify(report, null, 2)}\n`
);
process.exitCode = report !== undefined && report.errorFiles === 0 && report.eligibleFileCoverage === 1 ? 0 : 1;
