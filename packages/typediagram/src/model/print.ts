import {
  isTupleVariantFields,
  type Model,
  type ResolvedDecl,
  type ResolvedFunctionSignature,
  type ResolvedTypeRef,
} from "./types.js";
import { formatVariantName } from "../variant.js";

export function printSource(model: Model): string {
  const out: string[] = ["typeDiagram", ""];
  for (const d of model.decls) {
    out.push(...printTargeting(d));
    out.push(printDecl(d));
    out.push("");
  }
  const joined = out.join("\n");
  return collapseTrailingNewlines(joined);
}

function collapseTrailingNewlines(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 10) {
    end -= 1;
  }
  return end === s.length ? s : `${s.slice(0, end)}\n`;
}

function printTargeting(d: ResolvedDecl): string[] {
  const lines: string[] = [];
  if (d.targeting?.targets !== undefined) {
    lines.push(`@targets(${d.targeting.targets.join(", ")})`);
  }
  if (d.targeting?.skipTargets !== undefined) {
    lines.push(`@skipTargets(${d.targeting.skipTargets.join(", ")})`);
  }
  return lines;
}

function printDecl(d: ResolvedDecl): string {
  const generics = d.generics.length === 0 ? "" : `<${d.generics.join(", ")}>`;
  if (d.kind === "record") {
    const fields = d.fields.map((f) => `  ${f.name}: ${printRef(f.type)}`).join("\n");
    return `type ${d.name}${generics} {\n${fields}\n}`;
  }
  if (d.kind === "union") {
    const variants = d.variants
      .map((v) => {
        const head = formatVariantName(v.name, v.discriminant);
        if (v.fields.length === 0) {
          return `  ${head}`;
        }
        if (isTupleVariantFields(v.fields)) {
          return `  ${head}(${v.fields.map((f) => printRef(f.type)).join(", ")})`;
        }
        const inner = v.fields.map((f) => `${f.name}: ${printRef(f.type)}`).join(", ");
        return `  ${head} { ${inner} }`;
      })
      .join("\n");
    return `${d.untagged === true ? "untagged union" : "union"} ${d.name}${generics} {\n${variants}\n}`;
  }
  if (d.kind === "alias") {
    return `alias ${d.name}${generics} = ${printRef(d.target)}`;
  }
  const signatures = d.signatures.map(printSignature);
  const async = signatures[0]?.startsWith("async ") === true ? "async " : "";
  return signatures.length === 1
    ? `${async}function ${d.name}${generics}${signatures[0]?.replace(/^async /, "") ?? ""}`
    : `function ${d.name}${generics} {\n${signatures.map((signature) => `  ${signature}`).join("\n")}\n}`;
}

function printSignature(signature: ResolvedFunctionSignature): string {
  const params = signature.params.map((param) => `${param.name}: ${printRef(param.type)}`).join(", ");
  return `${signature.async === true ? "async " : ""}(${params}) -> ${printRef(signature.returns)}`;
}

function printRef(t: ResolvedTypeRef): string {
  if (t.args.length === 0) {
    return t.name;
  }
  return `${t.name}<${t.args.map(printRef).join(", ")}>`;
}
