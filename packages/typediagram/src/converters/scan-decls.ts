// [CONV-SCAN-DECLS] Structural decl-walking primitives shared by the regex
// source parsers (C#, Dart, Go, Protobuf, Python, F#).
//
// Every `fromSource` re-implements the same offset-driven walk: run a global
// regex over the source, collect each match with its `m.index` offset, and
// (usually) emit the collected decls in source order. The brace-delimited
// languages additionally track which byte ranges have been consumed by an
// outer block so an inner scan doesn't re-pick nested decls. Only the regexes,
// the per-match projection, and the field/type mapping differ per language —
// the walk itself is identical, so it lives here.
import { extractBalancedBlock } from "./brace-lang.js";

/** Anything carrying a source offset, so it can be ordered by position. */
export interface HasOffset {
  readonly offset: number;
}

/**
 * Run `re` globally over `source`, projecting each match through `project`
 * (which may return null to skip). Resets `re.lastIndex` first so callers can
 * reuse module-level regexes. Matches are returned in source order.
 */
export const scanAll = <T>(
  re: RegExp,
  source: string,
  project: (m: RegExpExecArray) => T | null
): T[] => {
  re.lastIndex = 0;
  const out: T[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const projected = project(m);
    if (projected !== null) {
      out.push(projected);
    }
  }
  return out;
};

/** Order collected decls by their source offset (ascending). */
export const orderBySource = <T extends HasOffset>(decls: readonly T[]): T[] =>
  [...decls].sort((a, b) => a.offset - b.offset);

/**
 * Track byte ranges already consumed by an outer brace block so later scans
 * can skip matches nested inside them. Used by every brace-delimited parser.
 */
export interface ConsumedTracker {
  /** Record `[start, end)` as consumed. */
  readonly consume: (start: number, end: number) => void;
  /** True when `idx` falls inside any consumed range. */
  readonly isInside: (idx: number) => boolean;
}

/** Create a fresh {@link ConsumedTracker}. */
export const makeConsumedTracker = (): ConsumedTracker => {
  const ranges: Array<[number, number]> = [];
  return {
    consume: (start, end) => {
      ranges.push([start, end]);
    },
    isInside: (idx) => ranges.some(([start, end]) => idx >= start && idx < end),
  };
};

/** A brace-block head match: its captured groups plus the block body. */
export interface BlockMatch {
  /** Regex capture groups (`groups[0]` is group 1, i.e. the name). */
  readonly groups: ReadonlyArray<string | undefined>;
  /** The balanced block contents between `{` and `}`. */
  readonly body: string;
  /** Offset of the match head in the source. */
  readonly offset: number;
  /** Offset one past the closing brace. */
  readonly endOffset: number;
}

/** Options controlling how a brace-block scan interacts with trackers. */
export interface ScanBlockOptions {
  /** Skip any match whose head is inside a range already consumed here. */
  readonly skip?: ConsumedTracker;
  /** Record each yielded match's range as consumed in this tracker. */
  readonly mark?: ConsumedTracker;
}

/**
 * Scan for brace-block heads: for each `re` match ending on `{`, extract the
 * balanced `{ … }` body and yield a {@link BlockMatch}. Matches inside a range
 * already consumed by `opts.skip` are dropped; each yielded match's range is
 * recorded in `opts.mark` so later scans can skip its nested decls.
 */
export const scanBraceBlocks = (source: string, re: RegExp, opts: ScanBlockOptions = {}): BlockMatch[] =>
  scanAll(re, source, (m) => toBlockMatch(source, m, opts));

const toBlockMatch = (source: string, m: RegExpExecArray, opts: ScanBlockOptions): BlockMatch | null => {
  if (opts.skip?.isInside(m.index) === true) {
    return null;
  }
  const full = m[0];
  const openIdx = m.index + full.length - 1;
  const body = extractBalancedBlock(source, openIdx, "{", "}");
  /* v8 ignore next 3 — a `{`-anchored regex guarantees a balanced `}` */
  if (body === null) {
    return null;
  }
  const endOffset = openIdx + body.length + 2;
  opts.mark?.consume(m.index, endOffset);
  return { groups: m.slice(1), body, offset: m.index, endOffset };
};

/**
 * Parse a block/DU body into `{ name, type }` field records. Splits on the
 * given separator, trims each part, drops blanks and `commentPrefix` lines,
 * matches `fieldRe` (name in group 1, type in group 2), and maps the raw type
 * through `mapType`. Parts that don't match `fieldRe` are dropped.
 */
export const parseFields = (
  body: string,
  opts: {
    readonly separator: string | RegExp;
    readonly commentPrefix: string;
    readonly fieldRe: RegExp;
    readonly mapType: (raw: string) => string;
  }
): Array<{ name: string; type: string }> =>
  body
    .split(opts.separator)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith(opts.commentPrefix))
    .map((l) => opts.fieldRe.exec(l))
    .flatMap((m) => (m === null ? [] : fieldFromMatch(m, opts.mapType)));

const fieldFromMatch = (
  m: RegExpExecArray,
  mapType: (raw: string) => string
): Array<{ name: string; type: string }> => {
  const [, name, type] = m;
  return name === undefined || type === undefined ? [] : [{ name, type: mapType(type) }];
};
