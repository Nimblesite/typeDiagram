import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

const __dirname = dirname(fileURLToPath(import.meta.url));

const wasmBin = readFileSync(resolve(__dirname, "../../node_modules/vscode-oniguruma/release/onig.wasm"));

const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin.buffer).then(() => ({
  createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
  createOnigString: (s) => new oniguruma.OnigString(s),
}));

const registry = new vsctm.Registry({
  onigLib: vscodeOnigurumaLib,
  loadGrammar: async (scopeName) =>
    scopeName === "source.typediagram"
      ? vsctm.parseRawGrammar(
          readFileSync(resolve(__dirname, "syntaxes/typediagram.tmLanguage.json"), "utf-8"),
          "typediagram.tmLanguage.json"
        )
      : null,
});

const grammar = await registry.loadGrammar("source.typediagram");

const testInput = `typeDiagram

# A comment
type User {
  name: String
  email: Option<String>
}

union Shape {
  Circle { radius: Float }
  Square
}

alias Email = String`;

const lines = testInput.split("\n");
let ruleStack = vsctm.INITIAL;
let failures = 0;

const expectations = [
  { line: "typeDiagram", token: "typeDiagram", scope: "keyword.other" },
  { line: "# A comment", token: "# A comment", scope: "comment.line" },
  { line: "type User {", token: "type", scope: "keyword.other" },
  { line: "type User {", token: "User", scope: "entity.name.type" },
  { line: "  name: String", token: "name", scope: "variable.other.property" },
  { line: "  name: String", token: "String", scope: "support.type" },
  { line: "  email: Option<String>", token: "Option", scope: "support.type" },
  { line: "union Shape {", token: "union", scope: "keyword.other" },
  { line: "union Shape {", token: "Shape", scope: "entity.name.type" },
  { line: "  Circle { radius: Float }", token: "Circle", scope: "entity.name.type" },
  { line: "  Circle { radius: Float }", token: "radius", scope: "variable.other.property" },
  { line: "  Circle { radius: Float }", token: "Float", scope: "support.type" },
  { line: "  Square", token: "Square", scope: "entity.name.type" },
  { line: "alias Email = String", token: "alias", scope: "keyword.other" },
  { line: "alias Email = String", token: "Email", scope: "entity.name.type" },
  { line: "alias Email = String", token: "String", scope: "support.type" },
];

const tokensByLine = new Map();
for (const line of lines) {
  const result = grammar.tokenizeLine(line, ruleStack);
  const tokens = result.tokens.map((t) => ({
    text: line.substring(t.startIndex, t.endIndex),
    scopes: t.scopes,
  }));
  tokensByLine.set(line, tokens);
  ruleStack = result.ruleStack;
}

for (const exp of expectations) {
  const tokens = tokensByLine.get(exp.line);
  const match = tokens?.find((t) => t.text === exp.token && t.scopes.some((s) => s.startsWith(exp.scope)));
  const status = match ? "PASS" : "FAIL";
  console.log(`${status}: "${exp.token}" in "${exp.line}" -> ${exp.scope}`);
  if (!match) {
    failures++;
    const found = tokens?.find((t) => t.text === exp.token);
    console.log(`       got scopes: ${found ? found.scopes.join(", ") : "(token not found)"}`);
  }
}

console.log(`\n${expectations.length - failures}/${expectations.length} passed`);
process.exit(failures > 0 ? 1 : 0);
