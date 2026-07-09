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
import { emitRustCodec, generateRustModule } from "typediagram-core/converters/rust-tdbin";
import { HELP_TEXT, parseArgs, type CliArgs } from "./args.js";
import { readSource } from "./io.js";
import { versionJson, versionText } from "./version.js";

type TdModelResult = { readonly ok: true; readonly value: modelLayer.Model } | { readonly ok: false };

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
      : argsResult.value.version
        ? versionFlow(argsResult.value, stdout, stderr)
        : argsResult.value.tdbinCommand !== null
          ? tdbinFlow(argsResult.value, stdout, stderr)
          : argsResult.value.from !== null
            ? fromLangFlow(argsResult.value, stdout, stderr)
            : argsResult.value.to !== null
              ? toLangFlow(argsResult.value, stdout, stderr)
              : renderFlow(argsResult.value, stdout, stderr);
};

/** [SWR-VERSION-CLI-OUTPUT] --version: print from package metadata and exit. No runtime, no network. */
const versionFlow = (args: CliArgs, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): number => {
  const r = args.json ? versionJson() : versionText();
  return r.ok ? (stdout.write(`${r.value}\n`), 0) : (stderr.write(`${r.error.message}\n`), 1);
};

/** [TDBIN-CLI] `.td` schema → generated Rust TDBIN glue or schema verification. */
const tdbinFlow = async (
  args: CliArgs,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): Promise<number> => {
  const model = await readTdModel(args.file, stderr);
  if (!model.ok) {
    return 1;
  }
  const codegenDiags = modelLayer.validateForCodegen(model.value, "rust");
  if (codegenDiags.length > 0) {
    return (writeDiagnostics(codegenDiags, stderr), 1);
  }
  const command = args.tdbinCommand;
  const generated = command === "decode" ? emitRustCodec(model.value) : generateRustModule(model.value);
  if (!generated.ok) {
    return (writeDiagnostics(generated.error, stderr), 1);
  }
  return command === "verify" ? (stdout.write("tdbin schema ok\n"), 0) : (stdout.write(generated.value), 0);
};

/** Parse and build typeDiagram source from file/stdin. */
const readTdModel = async (file: string | null, stderr: NodeJS.WritableStream): Promise<TdModelResult> => {
  const srcRes = await readSource(file);
  if (!srcRes.ok) {
    stderr.write(`${srcRes.error.message}\n`);
    return { ok: false };
  }
  const parsed = parser.parse(srcRes.value);
  if (!parsed.ok) {
    writeDiagnostics(parsed.error, stderr);
    return { ok: false };
  }
  const model = modelLayer.buildModel(parsed.value);
  if (!model.ok) {
    writeDiagnostics(model.error, stderr);
    return { ok: false };
  }
  return model;
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

  const conv = converters.byLanguage[args.from as NonNullable<CliArgs["from"]>];
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

  // [MODEL-CODEGEN-UNKNOWN] unknown type names must fail generation, not the
  // downstream build (GH issue #38).
  const to = args.to as NonNullable<CliArgs["to"]>;
  const codegenDiags = modelLayer.validateForCodegen(model.value, to);
  if (codegenDiags.length > 0) {
    return (writeDiagnostics(codegenDiags, stderr), 1);
  }
  const conv = converters.byLanguage[to];
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
