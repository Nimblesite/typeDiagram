/** Width per character in em units, monospace assumption. ASCII baseline. */
const ASCII_EM = 0.6;
/** Wide chars (CJK / emoji presentation) take a full em. */
const WIDE_EM = 1.0;

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals … Kangxi
  [0x3041, 0x33ff], // Hiragana, Katakana, CJK symbols, etc.
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f9ff], // Misc Symbols & Pictographs + Emoticons + Transport + Suppl. Symbols
  [0x20000, 0x2fffd], // CJK Extension B-F
  [0x30000, 0x3fffd], // CJK Extension G
];

function isWide(cp: number): boolean {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp >= lo && cp <= hi) {
      return true;
    }
  }
  return false;
}

export interface TextSize {
  w: number;
  h: number;
}

/** Measure a single line of text in pixels, monospace assumption. */
export function measureText(text: string, fontSize: number): TextSize {
  let widthEm = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    widthEm += isWide(cp) ? WIDE_EM : ASCII_EM;
  }
  return {
    w: widthEm * fontSize,
    h: fontSize * 1.2,
  };
}

/** Measure the longest line of a multi-line block. */
export function measureBlock(lines: readonly string[], fontSize: number): TextSize {
  let w = 0;
  for (const line of lines) {
    const m = measureText(line, fontSize);
    if (m.w > w) {
      w = m.w;
    }
  }
  return { w, h: lines.length * fontSize * 1.2 };
}
