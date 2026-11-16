// [CLI-IO] Read source from file path or stdin.
import { readFile } from "node:fs/promises";
import type { Result } from "./result.js";
import { err, ok } from "./result.js";

export interface IoError {
  readonly message: string;
}

export const readSource = async (file: string | null): Promise<Result<string, IoError>> => {
  return file === null ? readStdin() : readFileSafe(file);
};

const readFileSafe = async (path: string): Promise<Result<string, IoError>> => {
  try {
    return ok(await readFile(path, "utf8"));
  } catch (e) {
    return err({ message: `cannot read ${path}: ${(e as Error).message}` });
  }
};

const readStdin = (): Promise<Result<string, IoError>> => {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    process.stdin.on("data", (chunk: string | Buffer) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    process.stdin.on("end", () => {
      resolve(ok(chunks.join("")));
    });
    process.stdin.on("error", (e) => {
      resolve(err({ message: `stdin error: ${e.message}` }));
    });
  });
};
