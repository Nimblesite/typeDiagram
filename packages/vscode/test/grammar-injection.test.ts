// [VSCODE-MD-INJECTION-TEST] Proves the markdown injection grammar actually causes
// typeDiagram fenced code in a .md file to get source.typediagram scopes. Uses
// vscode-textmate (same engine VS Code uses) with the real VS Code markdown grammar
// + our two grammars wired together.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as vsctm from "vscode-textmate";
import type { IGrammar, Registry, StateStack } from "vscode-textmate";
import * as oniguruma from "vscode-oniguruma";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(__dirname, "..");
const WASM = resolve(__dirname, "../../../node_modules/vscode-oniguruma/release/onig.wasm");

async function loadRegistry(): Promise<Registry> {
  const wasmBin = readFileSync(WASM);
  await oniguruma.loadWASM(wasmBin.buffer);
  const onigLib = Promise.resolve({
    createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s: string) => new oniguruma.OnigString(s),
  });
  return new vsctm.Registry({
    onigLib,
    loadGrammar: (scopeName: string) => {
      const path =
        scopeName === "source.typediagram"
          ? resolve(PKG, "syntaxes/typediagram.tmLanguage.json")
          : scopeName === "markdown.typediagram.codeblock"
            ? resolve(PKG, "syntaxes/typediagram.markdown-injection.tmLanguage.json")
            : scopeName === "text.html.markdown"
              ? resolve(PKG, "test/fixtures/markdown.tmLanguage.json")
              : null;
      if (path === null) {
        return Promise.resolve(null);
      }
      return Promise.resolve(vsctm.parseRawGrammar(readFileSync(path, "utf-8"), path));
    },
    getInjections: (scopeName) => (scopeName === "text.html.markdown" ? ["markdown.typediagram.codeblock"] : []),
  });
}

interface TokenLine {
  text: string;
  scopes: readonly string[];
}

function tokenize(grammar: IGrammar, source: string): TokenLine[][] {
  const lines = source.split("\n");
  let ruleStack: StateStack = vsctm.INITIAL;
  const out: TokenLine[][] = [];
  for (const line of lines) {
    const r = grammar.tokenizeLine(line, ruleStack);
    out.push(r.tokens.map((t) => ({ text: line.substring(t.startIndex, t.endIndex), scopes: t.scopes })));
    ruleStack = r.ruleStack;
  }
  return out;
}

describe("[VSCODE-MD-INJECTION] markdown → typediagram fence injection", () => {
  const exampleMd = `# Something

\`\`\`typediagram
type ChatRequest {
  message: String
}
\`\`\`

other prose
`;

  const mixedCaseMd = `# Mixed

\`\`\`typeDiagram
type X { a: Int }
\`\`\`
`;

  it("injects typediagram scopes inside a lowercase typediagram fence", async () => {
    const registry = await loadRegistry();
    const grammar = await registry.loadGrammar("text.html.markdown");
    if (grammar === null) {
      throw new Error("failed to load markdown grammar");
    }
    const lines = tokenize(grammar, exampleMd);
    const declLine = lines.find((toks) => toks.some((t) => t.text === "ChatRequest"));
    expect(declLine).toBeDefined();
    const chatTok = declLine?.find((t) => t.text === "ChatRequest");
    expect(chatTok).toBeDefined();
    expect(chatTok?.scopes.some((s) => s === "meta.embedded.block.typediagram")).toBe(true);
    expect(chatTok?.scopes.some((s) => s === "entity.name.type.typediagram")).toBe(true);
    const fenceLine = lines.find((toks) => toks.some((t) => t.text === "typediagram"));
    const fenceTok = fenceLine?.find((t) => t.text === "typediagram");
    expect(fenceTok?.scopes.some((s) => s === "fenced_code.block.language.typediagram")).toBe(true);
  });

  it("highlights the 'type' keyword inside the fence", async () => {
    const registry = await loadRegistry();
    const grammar = await registry.loadGrammar("text.html.markdown");
    if (grammar === null) {
      throw new Error("failed to load markdown grammar");
    }
    const lines = tokenize(grammar, exampleMd);
    const typeLine = lines.find((toks) => toks.some((t) => t.text === "type"));
    const typeTok = typeLine?.find((t) => t.text === "type");
    expect(typeTok?.scopes.some((s) => s === "keyword.other.typediagram")).toBe(true);
  });

  it("highlights field names and types inside the fence", async () => {
    const registry = await loadRegistry();
    const grammar = await registry.loadGrammar("text.html.markdown");
    if (grammar === null) {
      throw new Error("failed to load markdown grammar");
    }
    const lines = tokenize(grammar, exampleMd);
    const fieldLine = lines.find((toks) => toks.some((t) => t.text === "message"));
    const messageTok = fieldLine?.find((t) => t.text === "message");
    expect(messageTok?.scopes.some((s) => s === "variable.other.property.typediagram")).toBe(true);
    const stringTok = fieldLine?.find((t) => t.text === "String");
    expect(stringTok?.scopes.some((s) => s === "support.type.typediagram")).toBe(true);
  });

  it("injects typediagram scopes for mixed-case typeDiagram fence", async () => {
    const registry = await loadRegistry();
    const grammar = await registry.loadGrammar("text.html.markdown");
    if (grammar === null) {
      throw new Error("failed to load markdown grammar");
    }
    const lines = tokenize(grammar, mixedCaseMd);
    const declLine = lines.find((toks) => toks.some((t) => t.text === "X"));
    expect(declLine).toBeDefined();
    const xTok = declLine?.find((t) => t.text === "X");
    expect(xTok?.scopes.some((s) => s === "meta.embedded.block.typediagram")).toBe(true);
    expect(xTok?.scopes.some((s) => s === "entity.name.type.typediagram")).toBe(true);
  });

  it("prose outside the fence does NOT get typediagram scopes", async () => {
    const registry = await loadRegistry();
    const grammar = await registry.loadGrammar("text.html.markdown");
    if (grammar === null) {
      throw new Error("failed to load markdown grammar");
    }
    const lines = tokenize(grammar, exampleMd);
    const proseLine = lines.find((toks) => toks.some((t) => t.text.includes("other prose")));
    expect(proseLine).toBeDefined();
    const contaminated = proseLine?.some((t) =>
      t.scopes.some((s) => s.endsWith(".typediagram") || s === "meta.embedded.block.typediagram")
    );
    expect(contaminated).toBe(false);
  });
});
