// [TDBIN-WIDTH-RANGE] Width-refined integer fields for the TypeScript TDBIN
// generator. Allocation mirrors the Rust emitter (one data word; `Option<width>`
// = presence bit + value word), so layouts and hashes match; the runtime
// `tdbin.width` range-checks every value on encode and decode.
import type { ResolvedTypeRef } from "../model/types.js";
import type { FieldPlan, TsWidth } from "./typescript-tdbin-defaults.js";

const WIDTHS: Readonly<Record<string, TsWidth>> = {
  I32: "i32",
  U8: "u8",
  U16: "u16",
  U32: "u32",
  U64: "u64",
  Size: "size",
};

/** The runtime width kind for a bare width primitive, else undefined. */
export const widthOf = (t: ResolvedTypeRef): TsWidth | undefined =>
  t.resolution.kind === "primitive" && t.args.length === 0 ? WIDTHS[t.name] : undefined;

type WidthPlan = Extract<FieldPlan, { kind: "width" | "optWidth" }>;

const kindArg = (width: TsWidth): string => `"${width}"`;

const read = (width: TsWidth, slot: number): string =>
  width === "u64"
    ? `tdbin.width.readU64(reader, at, ${String(slot)})`
    : `tdbin.width.readNumber(reader, at, ${String(slot)}, ${kindArg(width)})`;

/** Write lines reading `src`; the final binding is `${field}`. */
export const writeWidthLines = (field: string, src: string, plan: WidthPlan): string[] =>
  plan.kind === "width"
    ? [
        `    const ${field} = tdbin.width.writeScalar(writer, at, ${String(plan.slot)}, ${kindArg(plan.width)}, ${src});`,
      ]
    : [
        `    const ${field}Present = tdbin.writer.boolBit(writer, at, ${String(plan.presenceSlot)}, ${String(plan.presenceBit)}, ${src} !== undefined);`,
        `    if (!${field}Present.ok) return ${field}Present;`,
        `    const ${field} = tdbin.width.writeScalar(writer, at, ${String(plan.valueSlot)}, ${kindArg(plan.width)}, ${src} ?? ${plan.width === "u64" ? "0n" : "0"});`,
      ];

export const readWidthLines = (field: string, plan: WidthPlan): string[] =>
  plan.kind === "width"
    ? [`    const ${field}Word = ${read(plan.width, plan.slot)};`]
    : [
        `    const ${field}Present = tdbin.reader.boolBit(reader, at, ${String(plan.presenceSlot)}, ${String(plan.presenceBit)});`,
        `    const ${field}Word = ${read(plan.width, plan.valueSlot)};`,
      ];

export const widthResultNames = (field: string, plan: WidthPlan): string[] =>
  plan.kind === "width" ? [`${field}Word`] : [`${field}Present`, `${field}Word`];

export const widthValue = (field: string, plan: WidthPlan): string =>
  plan.kind === "width" ? `${field}Word.value` : `${field}Present.value ? ${field}Word.value : undefined`;

/** `List<width>` write/read expressions for the list emitter. */
export const widthListWrite = (target: string, width: TsWidth, source: string): string =>
  `tdbin.width.writeList(${target}, ${kindArg(width)}, ${source})`;

export const widthListRead = (src: string, width: TsWidth): string =>
  width === "u64" ? `tdbin.width.readU64List(${src})` : `tdbin.width.readNumberList(${src}, ${kindArg(width)})`;
