// [VSCODE-LOGGER] Structured logger — writes to VS Code Output Channel AND a file in
// the extension's storageUri. pino is awkward inside bundled VS Code extensions
// (worker_threads), so we use a tiny JSONL logger that satisfies the same goals.
import * as vscode from "vscode";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Level = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

export interface Logger {
  trace: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

interface LoggerState {
  channel: vscode.OutputChannel;
  filePath: string | null;
  minLevel: Level;
  bindings: Record<string, unknown>;
}

function fmtHuman(level: Level, msg: string, fields: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const extras = Object.keys(fields).length > 0 ? " " + JSON.stringify(fields) : "";
  return `${ts} [${level.toUpperCase()}] ${msg}${extras}`;
}

function fmtJsonl(level: Level, msg: string, fields: Record<string, unknown>): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n";
}

function writeLine(state: LoggerState, level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[state.minLevel]) {
    return;
  }
  const merged = { ...state.bindings, ...(fields ?? {}) };
  state.channel.appendLine(fmtHuman(level, msg, merged));
  if (state.filePath !== null) {
    try {
      appendFileSync(state.filePath, fmtJsonl(level, msg, merged));
    } catch {
      // best-effort file logging; never throw from a logger
    }
  }
}

function makeLogger(state: LoggerState): Logger {
  return {
    trace: (msg, fields) => {
      writeLine(state, "trace", msg, fields);
    },
    debug: (msg, fields) => {
      writeLine(state, "debug", msg, fields);
    },
    info: (msg, fields) => {
      writeLine(state, "info", msg, fields);
    },
    warn: (msg, fields) => {
      writeLine(state, "warn", msg, fields);
    },
    error: (msg, fields) => {
      writeLine(state, "error", msg, fields);
    },
    child: (bindings) => makeLogger({ ...state, bindings: { ...state.bindings, ...bindings } }),
  };
}

let globalState: LoggerState | null = null;

function ensureChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel("TypeDiagram");
}

export function initLogger(context: vscode.ExtensionContext): Logger {
  if (globalState === null) {
    globalState = { channel: ensureChannel(), filePath: null, minLevel: "trace", bindings: {} };
    context.subscriptions.push(globalState.channel);
  }
  try {
    mkdirSync(context.logUri.fsPath, { recursive: true });
    globalState.filePath = `${context.logUri.fsPath}/typediagram.log.jsonl`;
  } catch {
    globalState.filePath = null;
  }
  void dirname;
  return makeLogger(globalState);
}

// [LOGGER-GETTER] Some code paths (e.g. extendMarkdownIt called by VS Code BEFORE activate())
// need logging even without a context. Return a best-effort logger that writes to a
// lazy-created channel when no global state exists.
export function getLogger(): Logger {
  globalState ??= { channel: ensureChannel(), filePath: null, minLevel: "trace", bindings: {} };
  return makeLogger(globalState);
}

// [LOGGER-MIN-LEVEL-TEST] Test-only hook to exercise the level-filter branch without
// exposing a user-facing API we don't need. Safe to ship — does nothing when uninitialised.
export function _setMinLevelForTesting(level: Level): void {
  if (globalState !== null) {
    globalState.minLevel = level;
  }
}
