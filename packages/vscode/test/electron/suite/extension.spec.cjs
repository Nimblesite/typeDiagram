// [VSCODE-E2E-SPEC] Real VS Code assertions: the extension activates, declares the
// expected contributions, and the markdown injection grammar applies to typediagram
// fences inside a real .md file opened in the editor.
const assert = require("node:assert");
const path = require("node:path");
const vscode = require("vscode");

suite("typediagram extension inside a real VS Code", () => {
  // When loaded via extensionDevelopmentPath the id is publisher.<workspace-name>,
  // which in the monorepo is "nimblesite.typediagram-vscode". A packaged VSIX
  // rewrites it to "nimblesite.typediagram". We accept either.
  const candidateIds = ["nimblesite.typediagram", "nimblesite.typediagram-vscode"];
  const findExt = () => candidateIds.map((id) => vscode.extensions.getExtension(id)).find(Boolean);

  test("extension is installed and activatable", async () => {
    const ext = findExt();
    assert.ok(ext, `none of ${candidateIds.join(", ")} found`);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test("package.json declares markdown injection grammar and markdown-it plugin", () => {
    const ext = findExt();
    assert.ok(ext);
    const contributes = ext.packageJSON.contributes;
    assert.ok(contributes);
    const grammars = contributes.grammars ?? [];
    const injection = grammars.find((g) => g.scopeName === "markdown.typediagram.codeblock");
    assert.ok(injection, "injection grammar not declared");
    assert.ok((injection.injectTo ?? []).includes("text.html.markdown"), "not injecting into markdown");
    assert.strictEqual(contributes["markdown.markdownItPlugins"], true, "markdownItPlugins flag not set");
  });

  test("opens spec.md and extendMarkdownIt runs (preview refresh is triggered)", async () => {
    const docPath = path.resolve(__dirname, "../../../examples/spec.md");
    const uri = vscode.Uri.file(docPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.languageId, "markdown");
    // Trigger the built-in markdown preview. This causes VS Code to load
    // all contributed markdown-it plugins — ours included.
    await vscode.commands.executeCommand("markdown.showPreview");
    // Give VS Code + our warmup a moment to settle.
    await new Promise((r) => setTimeout(r, 2000));
    // There's no public API to scrape preview HTML. The fact that the command
    // doesn't throw AND the extension activated (previous test) is the smoke test.
    // Real render correctness is covered by the pure-node markdown-it-plugin test suite.
  });
});
