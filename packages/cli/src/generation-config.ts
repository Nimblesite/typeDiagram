// [CLI-CONFIG-GENERATE] Configured one-schema-to-many-language generation and watching.
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { converters, model as modelLayer, parser } from "typediagram-core";
import { err, errorMessage, ok, type Result } from "./result.js";

type GenerationError = { readonly message: string };
type OutputTarget = { readonly language: converters.Language; readonly path: string };
type GeneratedOutput = OutputTarget & { readonly content: string };
type GenerationConfig = {
  readonly source: string;
  readonly outputs: readonly OutputTarget[];
  readonly watch: boolean;
};

const recordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const languageValue = (value: string): value is converters.Language =>
  converters.LANGUAGES.some((language) => language === value);

const readText = async (path: string): Promise<Result<string, GenerationError>> => {
  try {
    return ok(await readFile(path, "utf8"));
  } catch (error) {
    return err({ message: `cannot read ${path}: ${errorMessage(error)}` });
  }
};

const parseJson = (text: string, path: string): Result<unknown, GenerationError> => {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch (error) {
    return err({ message: `cannot parse ${path}: ${errorMessage(error)}` });
  }
};

const parseOutput = ([language, path]: [string, unknown]): Result<OutputTarget, GenerationError> =>
  !languageValue(language)
    ? err({ message: `unsupported output language '${language}'` })
    : typeof path !== "string" || path.trim().length === 0
      ? err({ message: `output '${language}' expects a non-empty file path` })
      : ok({ language, path });

const collectResults = <T, E>(results: readonly Result<T, E>[]) => {
  const values: T[] = [];
  for (const result of results) {
    switch (result.ok) {
      case false:
        return result;
      case true:
        values.push(result.value);
        break;
    }
  }
  return ok(values);
};

const parseOutputs = (value: unknown) => {
  const results = recordValue(value) ? Object.entries(value).map(parseOutput) : [];
  return !recordValue(value)
    ? err<GenerationError>({ message: "config.outputs must be an object keyed by language" })
    : results.length === 0
      ? err<GenerationError>({ message: "config.outputs must select at least one language" })
      : collectResults(results);
};

const parseWatch = (value: unknown) =>
  value === undefined || typeof value === "boolean"
    ? ok(value === true)
    : err<GenerationError>({ message: "config.watch must be a boolean" });

const resolveConfig = (path: string, source: string, outputs: readonly OutputTarget[], watchEnabled: boolean) => {
  const root = dirname(resolve(path));
  const resolvedSource = resolve(root, source);
  const resolvedOutputs = outputs.map((output) => ({ ...output, path: resolve(root, output.path) }));
  const collision = resolvedOutputs.find((output) => output.path === resolvedSource);
  return collision === undefined
    ? ok({ source: resolvedSource, outputs: resolvedOutputs, watch: watchEnabled })
    : err<GenerationError>({ message: `output '${collision.language}' cannot overwrite the .td source` });
};

const parseConfig = (value: unknown, path: string): Result<GenerationConfig, GenerationError> => {
  const config = recordValue(value) ? value : undefined;
  const source = config?.source;
  const outputs = parseOutputs(config?.outputs);
  const watchEnabled = parseWatch(config?.watch);
  return config === undefined
    ? err({ message: "generation config must be a JSON object" })
    : typeof source !== "string" || source.trim().length === 0
      ? err({ message: "config.source must be a non-empty .td file path" })
      : !source.endsWith(".td")
        ? err({ message: "config.source must point to a .td file" })
        : !outputs.ok
          ? outputs
          : !watchEnabled.ok
            ? watchEnabled
            : resolveConfig(path, source, outputs.value, watchEnabled.value);
};

const loadConfig = async (path: string) => {
  const text = await readText(path);
  const json = text.ok ? parseJson(text.value, path) : text;
  return json.ok ? parseConfig(json.value, path) : json;
};

const modelFromSource = (source: string) => {
  const parsed = parser.parse(source);
  const built = parsed.ok ? modelLayer.buildModel(parsed.value) : parsed;
  return built.ok ? built : err<GenerationError>({ message: parser.formatDiagnostics([...built.error]) });
};

const generateOutput = (model: modelLayer.Model, output: OutputTarget) => {
  const diagnostics = modelLayer.validateForCodegen(model, output.language);
  return diagnostics.length === 0
    ? ok({ ...output, content: converters.byLanguage[output.language].toSource(model) })
    : err<GenerationError>({ message: parser.formatDiagnostics(diagnostics) });
};

const generateAll = async (config: GenerationConfig) => {
  const source = await readText(config.source);
  const model = source.ok ? modelFromSource(source.value) : source;
  return model.ok ? collectResults(config.outputs.map((output) => generateOutput(model.value, output))) : model;
};

const temporaryOutputPath = (path: string) =>
  resolve(dirname(path), `.${basename(path)}.${String(process.pid)}.typediagram.tmp`);

const writeOutput = async (output: GeneratedOutput): Promise<Result<GeneratedOutput, GenerationError>> => {
  try {
    await mkdir(dirname(output.path), { recursive: true });
    const temporary = temporaryOutputPath(output.path);
    await writeFile(temporary, output.content, "utf8");
    await rename(temporary, output.path);
    return ok(output);
  } catch (error) {
    return err({ message: `cannot write ${output.path}: ${errorMessage(error)}` });
  }
};

const writeAll = async (outputs: readonly GeneratedOutput[]) => {
  const results = await Promise.all(outputs.map(writeOutput));
  return collectResults(results);
};

const reportError = (error: GenerationError, stderr: NodeJS.WritableStream) => {
  stderr.write(`${error.message.trimEnd()}\n`);
  return false;
};

const reportGenerated = (outputs: readonly GeneratedOutput[], stdout: NodeJS.WritableStream) => {
  outputs.forEach((output) => {
    stdout.write(`generated ${output.language} -> ${output.path}\n`);
  });
  return true;
};

const generateOnce = async (config: GenerationConfig, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream) => {
  const generated = await generateAll(config);
  const written = generated.ok ? await writeAll(generated.value) : generated;
  return written.ok ? reportGenerated(written.value, stdout) : reportError(written.error, stderr);
};

const processAbortSignal = () => {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  controller.signal.addEventListener("abort", () => {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  });
  return controller.signal;
};

const openWatcher = (source: string, regenerate: () => void): Result<FSWatcher, GenerationError> => {
  try {
    const name = basename(source);
    return ok(
      watch(dirname(source), (_event, changed) => {
        const relevant = changed === null || changed === name;
        switch (relevant) {
          case true:
            regenerate();
            break;
        }
      })
    );
  } catch (error) {
    return err({ message: `cannot watch ${source}: ${errorMessage(error)}` });
  }
};

const watchOutcome = (reason: unknown) =>
  reason instanceof Error
    ? { code: 1, stdout: "", stderr: `watch failed: ${errorMessage(reason)}\n` }
    : { code: 0, stdout: "watch stopped\n", stderr: "" };

const finishWatcher = async (
  watcher: FSWatcher,
  pending: () => Promise<void>,
  reason: unknown,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
) => {
  const outcome = watchOutcome(reason);
  watcher.close();
  await pending();
  stderr.write(outcome.stderr);
  stdout.write(outcome.stdout);
  return outcome.code;
};

const waitForWatcher = (
  watcher: FSWatcher,
  pending: () => Promise<void>,
  signal: AbortSignal,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
) =>
  new Promise<number>((resolveStopped) => {
    const finish = (reason: unknown) => {
      void finishWatcher(watcher, pending, reason, stdout, stderr).then(resolveStopped);
    };
    watcher.once("error", finish);
    switch (signal.aborted) {
      case true:
        finish(undefined);
        break;
      case false:
        signal.addEventListener("abort", finish, { once: true });
        break;
    }
  });

const watchConfig = async (
  config: GenerationConfig,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
  signal?: AbortSignal
) => {
  let pending = Promise.resolve();
  const regenerate = () => {
    pending = pending.then(async () => {
      await generateOnce(config, stdout, stderr);
    });
  };
  const watcher = openWatcher(config.source, regenerate);
  stdout.write(watcher.ok ? `watching ${config.source}\n` : "");
  return watcher.ok
    ? waitForWatcher(watcher.value, () => pending, signal ?? processAbortSignal(), stdout, stderr)
    : (reportError(watcher.error, stderr), 1);
};

export const runGenerationConfig = async (
  path: string,
  forceWatch: boolean,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
  signal?: AbortSignal
) => {
  const loaded = await loadConfig(path);
  const initial = loaded.ok ? await generateOnce(loaded.value, stdout, stderr) : reportError(loaded.error, stderr);
  const watching = loaded.ok && (forceWatch || loaded.value.watch);
  return !loaded.ok || !watching ? (initial ? 0 : 1) : watchConfig(loaded.value, stdout, stderr, signal);
};
