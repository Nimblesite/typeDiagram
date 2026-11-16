// [VSCODE-LOGGER-TEST] Exhaustive assertions that the structured logger fires at every
// level, writes to the Output Channel, writes JSONL to the log file, and attaches
// child bindings. Proves that logs ACTUALLY HAPPEN — every level, every call.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "./vscode-mock.js";
import { readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import type * as fsModule from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("vscode", () => mock);

const TEST_LOG_DIR = join(tmpdir(), "td-logger-test");

describe("[VSCODE-LOGGER] structured logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.mockOutputChannel.appendLine.mockClear();
    if (existsSync(TEST_LOG_DIR)) {
      rmSync(TEST_LOG_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_LOG_DIR, { recursive: true });
  });

  const makeCtx = () => ({
    subscriptions: [] as unknown[],
    logUri: { fsPath: TEST_LOG_DIR },
    globalStorageUri: { fsPath: TEST_LOG_DIR },
  });

  it("creates an Output Channel named 'TypeDiagram'", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    initLogger(makeCtx() as never);
    expect(mock.window.createOutputChannel).toHaveBeenCalledWith("TypeDiagram");
  });

  it("writes an info log to the Output Channel with timestamp + level + msg", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    log.info("hello");
    expect(mock.mockOutputChannel.appendLine).toHaveBeenCalledOnce();
    const line = mock.mockOutputChannel.appendLine.mock.calls[0]?.[0] as string;
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] hello$/);
  });

  it("writes each level with the correct tag", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    log.trace("t");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("[TRACE] t");
    expect(lines[1]).toContain("[DEBUG] d");
    expect(lines[2]).toContain("[INFO] i");
    expect(lines[3]).toContain("[WARN] w");
    expect(lines[4]).toContain("[ERROR] e");
  });

  it("serializes structured fields as JSON after the message", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    log.info("event", { userId: 42, action: "checkout" });
    const line = mock.mockOutputChannel.appendLine.mock.calls[0]?.[0] as string;
    expect(line).toContain('"userId":42');
    expect(line).toContain('"action":"checkout"');
  });

  it("child logger merges bindings into every emitted line", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    const child = log.child({ scope: "md-plugin" });
    child.info("rendering", { svgLength: 1200 });
    const line = mock.mockOutputChannel.appendLine.mock.calls[0]?.[0] as string;
    expect(line).toContain('"scope":"md-plugin"');
    expect(line).toContain('"svgLength":1200');
  });

  it("writes JSONL to the log file with ts/level/msg fields", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    log.info("payload", { k: "v" });
    const logFile = join(TEST_LOG_DIR, "typediagram.log.jsonl");
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf8");
    const entry = JSON.parse(content.trim()) as { ts: string; level: string; msg: string; k: string };
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("payload");
    expect(entry.k).toBe("v");
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("writes every log call to the file (fan-out)", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    log.info("one");
    log.warn("two");
    log.error("three");
    const logFile = join(TEST_LOG_DIR, "typediagram.log.jsonl");
    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ level: "info", msg: "one" });
    expect(JSON.parse(lines[1] as string)).toMatchObject({ level: "warn", msg: "two" });
    expect(JSON.parse(lines[2] as string)).toMatchObject({ level: "error", msg: "three" });
  });

  it("survives file-write failure (logs only to channel, never throws)", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger({ subscriptions: [], logUri: { fsPath: "/nonexistent/cannot/create" } } as never);
    // Should NOT throw even though file path is invalid
    expect(() => {
      log.info("still-works");
    }).not.toThrow();
    expect(mock.mockOutputChannel.appendLine).toHaveBeenCalled();
  });

  it("getLogger returns a usable logger when called before initLogger", async () => {
    vi.resetModules();
    const { getLogger } = await import("../src/logger.js");
    const log = getLogger();
    expect(() => {
      log.info("pre-init event", { phase: "extend" });
    }).not.toThrow();
    expect(mock.window.createOutputChannel).toHaveBeenCalledWith("TypeDiagram");
    const line = mock.mockOutputChannel.appendLine.mock.calls[0]?.[0] as string;
    expect(line).toContain("pre-init event");
    expect(line).toContain('"phase":"extend"');
  });

  it("initLogger after getLogger reuses the same channel (no duplicate channel)", async () => {
    vi.resetModules();
    const { getLogger, initLogger } = await import("../src/logger.js");
    getLogger().info("first");
    const createBefore = mock.window.createOutputChannel.mock.calls.length;
    initLogger(makeCtx() as never);
    // initLogger should NOT create a second channel
    expect(mock.window.createOutputChannel.mock.calls.length).toBe(createBefore);
  });

  it("_setMinLevelForTesting is a no-op before init (doesn't throw)", async () => {
    vi.resetModules();
    const { _setMinLevelForTesting } = await import("../src/logger.js");
    expect(() => {
      _setMinLevelForTesting("warn");
    }).not.toThrow();
  });

  it("filters out levels below minLevel", async () => {
    vi.resetModules();
    const { initLogger, _setMinLevelForTesting } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    _setMinLevelForTesting("warn");
    log.trace("t");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[WARN] w");
    expect(lines[1]).toContain("[ERROR] e");
    _setMinLevelForTesting("trace");
  });

  it("when file path is set but appendFileSync throws (read-only FS simulated), the catch swallows it", async () => {
    vi.resetModules();
    // Mock node:fs so appendFileSync throws. Must mock BEFORE importing the logger.
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof fsModule>();
      return {
        ...actual,
        appendFileSync: () => {
          throw new Error("simulated EACCES");
        },
      };
    });
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    expect(() => {
      log.info("will-swallow");
    }).not.toThrow();
    // Channel still received the line — file failure doesn't kill console output
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("will-swallow"))).toBe(true);
    vi.doUnmock("node:fs");
  });

  it("child of child merges all bindings top-down", async () => {
    vi.resetModules();
    const { initLogger } = await import("../src/logger.js");
    const log = initLogger(makeCtx() as never);
    const a = log.child({ a: 1 });
    const b = a.child({ b: 2 });
    b.info("nested", { c: 3 });
    const line = mock.mockOutputChannel.appendLine.mock.calls[0]?.[0] as string;
    expect(line).toContain('"a":1');
    expect(line).toContain('"b":2');
    expect(line).toContain('"c":3');
  });
});
