#!/usr/bin/env node
// [CLI-MAIN] typediagram CLI entry. Pure consumer of the framework public API.
import {
  parser,
  model as modelLayer,
  renderToString,
  converters,
  type AllOpts,
  type Diagnostic,
} from "typediagram-core";
import { HELP_TEXT, parseArgs, type CliArgs } from "./args.js";
import { readSource } from "./io.js";

export const main = async (
  argv: readonly string[],
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): Promise<number> => {
  const argsResult = parseArgs(argv);
  return !argsResult.ok
    ? (stderr.write(`${argsResult.error.message}\n${HELP_TEXT}`), 1)
    : argsResult.value.help
      ? (stdout.write(HELP_TEXT), 0)
      : argsResult.value.from !== null
        ? fromLangFlow(argsResult.value, stdout, stderr)
        : argsResult.value.to !== null
          ? toLangFlow(argsResult.value, stdout, stderr)
          : renderFlow(argsResult.value, stdout, stderr);
};

/** --from: language source → typeDiagram model → td / SVG / both */
const fromLangFlow = async (
  args: CliArgs,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): Promise<number> => {
  const srcRes = await readSource(args.file);
  if (!srcRes.ok) {
    return (stderr.write(`${srcRes.error.message}\n`), 1);
  }

  if (args.from === null) {
    return (stderr.write("missing --from\n"), 1);
  }
  const conv = converters.byLanguage[args.from];
  const modelResult = conv.fromSource(srcRes.value);
  if (!modelResult.ok) {
    return (writeDiagnostics(modelResult.error, stderr), 1);
  }

  const tdSource = modelLayer.printSource(modelResult.value);
  return args.emit === "td" ? (stdout.write(tdSource), 0) : emitSvg(tdSource, args, stdout, stderr);
};

/** [CLI-EMIT-SVG] Render td source and write SVG (with optional td prefix). */
const emitSvg = async (
  tdSource: string,
  args: CliArgs,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): Promise<number> => {
  const svgResult = await renderToString(tdSource, toRenderOpts(args));
  if (!svgResult.ok) {
    return (writeDiagnostics(svgResult.error, stderr), 1);
  }
  const prefix = args.emit === "td+svg" ? `${tdSource}\n---\n` : "";
  stdout.write(prefix);
  stdout.write(svgResult.value);
  return 0;
};

/** --to: typeDiagram source → model → language source */
const toLangFlow = async (
  args: CliArgs,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): Promise<number> => {
  const srcRes = await readSource(args.file);
  if (!srcRes.ok) {
    return (stderr.write(`${srcRes.error.message}\n`), 1);
  }

  const parsed = parser.parse(srcRes.value);
  if (!parsed.ok) {
    return (writeDiagnostics(parsed.error, stderr), 1);
  }

  const model = modelLayer.buildModel(parsed.value);
  if (!model.ok) {
    return (writeDiagnostics(model.error, stderr), 1);
  }

  if (args.to === null) {
    return (stderr.write("missing --to\n"), 1);
  }
  const conv = converters.byLanguage[args.to];
  stdout.write(conv.toSource(model.value));
  return 0;
};

/** Default: typeDiagram source → SVG */
const renderFlow = async (
  args: CliArgs,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): Promise<number> => {
  const srcRes = await readSource(args.file);
  if (!srcRes.ok) {
    return (stderr.write(`${srcRes.error.message}\n`), 1);
  }
  const result = await renderToString(srcRes.value, toRenderOpts(args));
  return result.ok ? (stdout.write(result.value), 0) : (writeDiagnostics(result.error, stderr), 1);
};

const toRenderOpts = (args: CliArgs): AllOpts => {
  const base: AllOpts = { theme: args.theme };
  return args.fontSize === null ? base : { ...base, fontSize: args.fontSize };
};

const writeDiagnostics = (diags: readonly Diagnostic[], stderr: NodeJS.WritableStream) => {
  stderr.write(parser.formatDiagnostics([...diags]));
  stderr.write("\n");
};
