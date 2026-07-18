// [TYPESHED-BULK] Mirror a typeshed checkout into one .td file per non-empty .pyi.
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { converters, model } from "typediagram-core";
import { err, errorMessage, ok, type Result } from "./result.js";

interface BulkError {
  readonly message: string;
}

interface FileOutcome {
  readonly kind: "converted" | "empty";
  readonly declarations: number;
}

const pyiPaths = (tree: string, names: string[]) =>
  names.filter((name) => name.endsWith(".pyi")).map((name) => join(tree, name));

const stubFiles = async (root: string): Promise<Result<string[], BulkError>> => {
  try {
    const stdlib = join(root, "stdlib");
    const stubs = join(root, "stubs");
    const [stdlibEntries, stubEntries] = await Promise.all([
      readdir(stdlib, { recursive: true }),
      readdir(stubs, { recursive: true }),
    ]);
    return ok([...pyiPaths(stdlib, stdlibEntries), ...pyiPaths(stubs, stubEntries)]);
  } catch (error) {
    return err({ message: `cannot scan typeshed root ${root}: ${errorMessage(error)}` });
  }
};

const outputPath = (sourceRoot: string, outputRoot: string, source: string) => {
  const path = relative(sourceRoot, source);
  return join(outputRoot, `${path.slice(0, -4)}.td`);
};

const atomicWrite = async (path: string, content: string): Promise<Result<true, BulkError>> => {
  try {
    const parent = dirname(path);
    await mkdir(parent, { recursive: true });
    const temporaryRoot = await mkdtemp(join(parent, ".typediagram-"));
    try {
      const temporary = join(temporaryRoot, "output.td");
      await writeFile(temporary, content, "utf8");
      await rename(temporary, path);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    return ok(true);
  } catch (error) {
    return err({ message: `cannot write ${path}: ${errorMessage(error)}` });
  }
};

const convertFile = async (
  sourceRoot: string,
  outputRoot: string,
  path: string
): Promise<Result<FileOutcome, BulkError>> => {
  try {
    const analyzed = converters.typeshed.analyzeSource(await readFile(path, "utf8"));
    if (!analyzed.ok && analyzed.error.every((diagnostic) => diagnostic.message === "No typeshed declarations found")) {
      return ok({ kind: "empty", declarations: 0 });
    }
    if (!analyzed.ok) {
      return err({ message: `${path}: ${analyzed.error.map((diagnostic) => diagnostic.message).join("; ")}` });
    }
    const written = await atomicWrite(
      outputPath(sourceRoot, outputRoot, path),
      model.printSource(analyzed.value.model)
    );
    return written.ok ? ok({ kind: "converted", declarations: analyzed.value.model.decls.length }) : written;
  } catch (error) {
    return err({ message: `cannot convert ${path}: ${errorMessage(error)}` });
  }
};

const convertAll = async (sourceRoot: string, outputRoot: string, files: string[]) => {
  const outcomes: FileOutcome[] = [];
  for (const file of files) {
    const converted = await convertFile(sourceRoot, outputRoot, file);
    if (!converted.ok) {
      return converted;
    }
    outcomes.push(converted.value);
  }
  return ok(outcomes);
};

const summary = (outcomes: FileOutcome[]) => {
  const converted = outcomes.filter((outcome) => outcome.kind === "converted").length;
  const empty = outcomes.length - converted;
  const declarations = outcomes.reduce((total, outcome) => total + outcome.declarations, 0);
  return `converted ${String(converted)} typeshed files (${String(declarations)} declarations); skipped ${String(empty)} files without declarations\n`;
};

export const typeshedMain = async (
  argv: readonly string[],
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
) => {
  const sourceRoot = argv[0] === undefined ? undefined : resolve(argv[0]);
  const outputRoot = argv[1] === undefined ? undefined : resolve(argv[1]);
  if (sourceRoot === undefined || outputRoot === undefined) {
    stderr.write("usage: typediagram-typeshed <typeshed-root> <output-root>\n");
    return 1;
  }
  const files = await stubFiles(sourceRoot);
  const converted = files.ok ? await convertAll(sourceRoot, outputRoot, files.value) : files;
  return converted.ok ? (stdout.write(summary(converted.value)), 0) : (stderr.write(`${converted.error.message}\n`), 1);
};
