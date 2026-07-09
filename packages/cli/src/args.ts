// [CLI-ARGS] Parse argv for typediagram CLI.
import { converters } from "typediagram-core";
import type { Result } from "./result.js";
import { err, ok } from "./result.js";

export type Theme = "light" | "dark";
export type TdbinCommand = "encode" | "decode" | "verify";
// [CLI-LANG] The supported language set is the framework registry — never hardcoded here,
// so the CLI can never advertise a language the framework cannot emit (or omit one it can).
export type Lang = converters.Language;
export type Emit = "svg" | "td" | "td+svg";

const LANG_LIST = converters.LANGUAGES.join("|");
const TDBIN_COMMANDS: ReadonlySet<TdbinCommand> = new Set<TdbinCommand>(["encode", "decode", "verify"]);

export interface CliArgs {
  readonly file: string | null;
  readonly tdbinCommand: TdbinCommand | null;
  readonly theme: Theme;
  readonly fontSize: number | null;
  readonly from: Lang | null;
  readonly to: Lang | null;
  readonly emit: Emit;
  readonly help: boolean;
  readonly version: boolean;
  readonly json: boolean;
}

export interface ArgError {
  readonly message: string;
}

const THEMES: ReadonlySet<Theme> = new Set<Theme>(["light", "dark"]);
const LANGS: ReadonlySet<Lang> = new Set<Lang>(converters.LANGUAGES);
const EMITS: ReadonlySet<Emit> = new Set<Emit>(["svg", "td", "td+svg"]);

const isTheme = (v: string): v is Theme => THEMES.has(v as Theme);
const isTdbinCommand = (v: string): v is TdbinCommand => TDBIN_COMMANDS.has(v as TdbinCommand);
const isLang = (v: string): v is Lang => LANGS.has(v as Lang);
const isEmit = (v: string): v is Emit => EMITS.has(v as Emit);

const parseFontSize = (v: string): Result<number, ArgError> => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? ok(n) : err({ message: `--font-size expects positive number, got ${v}` });
};

export const parseArgs = (argv: readonly string[]): Result<CliArgs, ArgError> => {
  const state = {
    file: null as string | null,
    tdbinCommand: null as TdbinCommand | null,
    theme: "light" as Theme,
    fontSize: null as number | null,
    from: null as Lang | null,
    to: null as Lang | null,
    emit: "svg" as Emit,
    help: false,
    version: false,
    json: false,
  };
  const it = argv[Symbol.iterator]();
  let cur = it.next();
  while (cur.done !== true) {
    const a = cur.value;
    const next = () => {
      cur = it.next();
      return cur.done === true ? null : cur.value;
    };
    const res = applyArg(a, next, state);
    if (!res.ok) {
      return res;
    }
    cur = it.next();
  }
  return state.from !== null && state.to !== null
    ? err({ message: "--from and --to are mutually exclusive" })
    : state.tdbinCommand !== null && (state.from !== null || state.to !== null)
      ? err({ message: "tdbin commands cannot be combined with --from or --to" })
      : state.json && !state.version
        ? err({ message: "--json requires --version" })
        : ok(state);
};

const applyArg = (
  a: string,
  next: () => string | null,
  s: {
    file: string | null;
    tdbinCommand: TdbinCommand | null;
    theme: Theme;
    fontSize: number | null;
    from: Lang | null;
    to: Lang | null;
    emit: Emit;
    help: boolean;
    version: boolean;
    json: boolean;
  }
): Result<true, ArgError> =>
  a === "-h" || a === "--help"
    ? ((s.help = true), ok(true as const))
    : a === "--version"
      ? ((s.version = true), ok(true as const))
      : a === "--json"
        ? ((s.json = true), ok(true as const))
        : a === "--theme"
          ? applyTheme(next(), s)
          : a === "--font-size"
            ? applyFontSize(next(), s)
            : a === "--from"
              ? applyLang(next(), s, "from")
              : a === "--to"
                ? applyLang(next(), s, "to")
                : a === "--emit"
                  ? applyEmit(next(), s)
                  : a.startsWith("-")
                    ? err({ message: `unknown flag: ${a}` })
                    : s.tdbinCommand === null && s.file === null && isTdbinCommand(a)
                      ? ((s.tdbinCommand = a), ok(true as const))
                      : s.file !== null
                        ? err({ message: `unexpected positional arg: ${a}` })
                        : ((s.file = a), ok(true as const));

const applyTheme = (v: string | null, s: { theme: Theme }): Result<true, ArgError> =>
  v === null
    ? err({ message: "--theme expects a value" })
    : isTheme(v)
      ? ((s.theme = v), ok(true as const))
      : err({ message: `--theme expects light|dark, got ${v}` });

const applyFontSize = (v: string | null, s: { fontSize: number | null }): Result<true, ArgError> => {
  if (v === null) {
    return err({ message: "--font-size expects a value" });
  }
  const r = parseFontSize(v);
  return r.ok ? ((s.fontSize = r.value), ok(true as const)) : r;
};

const applyLang = (
  v: string | null,
  s: { from: Lang | null; to: Lang | null },
  key: "from" | "to"
): Result<true, ArgError> =>
  v === null
    ? err({ message: `--${key} expects ${LANG_LIST}` })
    : isLang(v)
      ? ((s[key] = v), ok(true as const))
      : err({
          message: `--${key} expects ${LANG_LIST}, got ${v}`,
        });

const applyEmit = (v: string | null, s: { emit: Emit }): Result<true, ArgError> =>
  v === null
    ? err({ message: "--emit expects svg|td|td+svg" })
    : isEmit(v)
      ? ((s.emit = v), ok(true as const))
      : err({ message: `--emit expects svg|td|td+svg, got ${v}` });

export const HELP_TEXT = `typediagram — render typeDiagram DSL to SVG, or convert between languages

Usage:
  typediagram [options] [file]
  typediagram encode [file]
  typediagram decode [file]
  typediagram verify [file]

Options:
  --from LANG          Convert from language source to SVG
  --to   LANG          Convert from typeDiagram to language source
  --emit svg|td|td+svg Output format for --from (default: svg)
  --theme light|dark   Color theme (default: light)
  --font-size N        Font size in px
  --version            Print version; add --json for machine-readable output
  -h, --help           Show this help

LANG is one of: ${LANG_LIST}

If file is omitted, reads from stdin.
SVG (or language source with --to) is written to stdout.
With --emit td, outputs the intermediate typeDiagram source.
With --emit td+svg, outputs typeDiagram source then a --- separator then SVG.
TDBIN encode emits a generated Rust ADT+codec module; decode emits codec impls for generated Rust ADTs; verify validates schema support.
Errors go to stderr; exit code 1 on failure.
`;
