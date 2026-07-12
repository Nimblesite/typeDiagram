// [VSCODE-TEST-HELPERS] Shared black-box harness for the extension + markdown-it
// suites. Consolidates the repeated activate() bootstrap, the fake document and
// extension-context factories, the markdown export target URI shape, and the
// capturing logger that every suite would otherwise re-inline. Tests still drive
// the extension only through its real activate()/exported API surface.

/** A fake VS Code text document with the fields the extension reads. */
export const makeDoc = (text: string, langId = "typediagram", scheme = "file") => ({
  uri: {
    path: `/test/${langId}.td`,
    scheme,
    toString: () => `${scheme}:///test/${langId}.td`,
  },
  getText: () => text,
  languageId: langId,
});

/** A fake ExtensionContext with subscriptions + the metadata activate() logs. */
export const makeContext = () => ({
  extensionUri: { path: "/ext" },
  extensionPath: "/ext",
  extension: { packageJSON: { version: "0.3.0-test" } },
  logUri: { fsPath: "/tmp/td-log-test" },
  globalStorageUri: { fsPath: "/tmp/td-log-test" },
  subscriptions: [] as { dispose: () => void }[],
});

/** Freshly import extension.js, build a context, and activate it. */
export const activateExtension = async () => {
  const { activate } = await import("../src/extension.js");
  const ctx = makeContext();
  const api = await activate(ctx as never);
  return { ctx, api };
};

/** A markdown file URI whose `.with({ path })` rebuilds a sibling file URI. */
export const mdTargetUri = (path: string) => ({
  path,
  scheme: "file",
  toString: () => `file://${path}`,
  with: (changes: { path: string }) => ({
    path: changes.path,
    scheme: "file",
    toString: () => `file://${changes.path}`,
  }),
});

/** Log entry captured by {@link makeCaptureLogger}. */
export interface CapturedLog {
  readonly level: string;
  readonly msg: string;
  readonly fields: Record<string, unknown>;
}

/** A logger that records every call so tests can assert on emitted events. */
export const makeCaptureLogger = () => {
  const entries: CapturedLog[] = [];
  const push = (level: string) => (msg: string, fields?: Record<string, unknown>) => {
    entries.push({ level, msg, fields: fields ?? {} });
  };
  const logger = {
    trace: push("trace"),
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
    child: () => logger,
  };
  return { logger, entries };
};
