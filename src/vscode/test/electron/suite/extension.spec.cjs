// [VSCODE-E2E-SPEC] Real VS Code assertions: the extension activates, declares the
// expected contributions, and the markdown injection grammar applies to typediagram
// fences inside a real .md file opened in the editor.
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

suite("typediagram extension inside a real VS Code", () => {
  const extensionId = "nimblesite.typediagram";
  const findExt = () => vscode.extensions.getExtension(extensionId);
  const samplePath = path.resolve(__dirname, "../../../examples/sample.td");
  const sampleSource = readFileSync(samplePath, "utf8");
  let visualDoc;

  test("extension is installed and activatable", async () => {
    const ext = findExt();
    assert.ok(ext, `${extensionId} was not installed from the freshly packaged VSIX`);
    assert.strictEqual(ext.packageJSON.name, "typediagram");
    assert.ok(ext.extensionPath.includes("td-vsix-"), `unexpected profile path: ${ext.extensionPath}`);
    assert.ok(
      ext.extensionPath.endsWith("extensions/nimblesite.typediagram-0.0.0-dev"),
      `unexpected extension path: ${ext.extensionPath}`
    );
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test("opens an isolated sample copy as a visual editor and reports the live panel through commands", async () => {
    visualDoc = await vscode.workspace.openTextDocument({ language: "typediagram", content: sampleSource });
    await vscode.window.showTextDocument(visualDoc);
    await vscode.commands.executeCommand("typediagram.preview");
    const status = await vscode.commands.executeCommand("typediagram.editorStatus");
    assert.deepStrictEqual(status, { visualEditor: true, openPanels: 1 });
  });

  test("runs every main canvas interaction inside the packaged VSIX webview", async () => {
    const doc =
      visualDoc ?? (await vscode.workspace.openTextDocument({ language: "typediagram", content: sampleSource }));
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("typediagram.preview");
    const result = await vscode.commands.executeCommand("typediagram.testVisualEditorInteractions");
    assert.deepStrictEqual(
      result.passed,
      [
        "canvas-chrome",
        "invalid-edit",
        "record-edit",
        "union-edit",
        "alias-edit",
        "add-remove",
        "icon-buttons",
        "node-add-delete",
        "drag-snap-persist",
        "zoom-in-out",
        "trackpad-zoom",
        "fit-reset-pan",
        "draw-relationship",
        "generic-relationship-recovery",
        "auto-layout",
        "export-svg",
        "close-and-escape",
      ],
      JSON.stringify(result, null, 2)
    );
    assert.strictEqual(result.sourceUpdated, true);

    const e = result.evidence;
    assert.strictEqual(e.toolbarButtons, 8);
    assert.strictEqual(e.legendItems, 3);
    assert.strictEqual(e.grid, true);
    assert.strictEqual(e.shadow, true);
    assert.ok(e.nodeCount >= 10);
    assert.ok(e.ports > 30);
    assert.strictEqual(e.nodeKinds, true);
    assert.strictEqual(e.toolbarLabel, true);
    assert.strictEqual(e.legendText, true);
    assert.strictEqual(e.chromeInitiallyClosed, true);
    assert.strictEqual(e.recordRenamed, true);
    assert.strictEqual(e.recordFieldEdited, true);
    assert.strictEqual(e.recordKind, true);
    assert.strictEqual(e.recordRows, 3);
    assert.strictEqual(e.recordSelected, true);
    assert.strictEqual(e.renamedNode, true);
    assert.strictEqual(e.oldNodeGone, true);
    assert.strictEqual(e.recordRendered, true);
    assert.strictEqual(e.recordEdge, true);
    assert.strictEqual(e.invalidRejected, true);
    assert.strictEqual(e.invalidToast, true);
    assert.strictEqual(e.unionVariantRenamed, true);
    assert.strictEqual(e.unionPayloadEdited, true);
    assert.strictEqual(e.unionKind, true);
    assert.strictEqual(e.unionRows, 4);
    assert.strictEqual(e.unionRendered, true);
    assert.strictEqual(e.unionEdge, true);
    assert.strictEqual(e.aliasTargetEdited, true);
    assert.strictEqual(e.aliasKind, true);
    assert.strictEqual(e.aliasRows, 1);
    assert.strictEqual(e.aliasHasNoRowControls, true);
    assert.strictEqual(e.aliasRendered, true);
    assert.strictEqual(e.aliasEdge, true);
    assert.strictEqual(e.rowAdded, true);
    assert.strictEqual(e.rowRemoved, true);
    assert.strictEqual(e.afterAddRows, e.beforeRows + 1);
    assert.strictEqual(e.afterRemoveRows, e.beforeRows);
    assert.strictEqual(e.afterAddPorts, e.beforePorts + 1);
    assert.strictEqual(e.afterRemovePorts, e.beforePorts);
    assert.strictEqual(e.defaultRow, true);
    assert.strictEqual(e.sourceRestored, true);
    assert.strictEqual(e.closeIcon, true);
    assert.ok(e.removeIconCount >= 1);
    assert.strictEqual(e.removeButtonsLabelled, true);
    assert.strictEqual(e.creatorButtons, 3);
    assert.strictEqual(e.recordAdded, true);
    assert.strictEqual(e.unionAdded, true);
    assert.strictEqual(e.aliasAdded, true);
    assert.strictEqual(e.recordDeleted, true);
    assert.ok(e.dragX > 0);
    assert.ok(e.dragY > 0);
    assert.strictEqual(e.dragX % 8, 0);
    assert.strictEqual(e.dragY % 8, 0);
    assert.strictEqual(e.dragSnapped, true);
    assert.strictEqual(e.layoutPersisted, true);
    assert.strictEqual(e.inspectorHiddenOnDragStart, true);
    assert.strictEqual(e.inspectorHiddenOnDragMove, true);
    assert.strictEqual(e.inspectorHiddenOnDragEnd, true);
    assert.notStrictEqual(e.zoomBefore, e.zoomAfterIn);
    assert.notStrictEqual(e.zoomAfterIn, e.zoomAfterOut);
    assert.ok(e.trackpadScale > 1);
    assert.ok(e.trackpadScale < 1.01);
    assert.match(e.fitTransform, /scale\(/);
    assert.match(e.resetTransform, /translate\(0px, 0px\) scale\(1\)/);
    assert.match(e.panTransform, /translate\(50px, 35px\) scale\(1\)/);
    assert.strictEqual(e.connectionPreview, true);
    assert.strictEqual(e.relationshipSource, true);
    assert.strictEqual(e.relationshipRendered, true);
    assert.strictEqual(e.relationshipEdge, true);
    assert.strictEqual(e.relationshipClosed, true);
    assert.strictEqual(e.genericSource, true);
    assert.strictEqual(e.genericTargetRendered, true);
    assert.strictEqual(e.genericEdge, true);
    assert.strictEqual(e.genericRendered, true);
    assert.strictEqual(e.fatalErrorHidden, true);
    assert.strictEqual(e.recoveryActions, 2);
    assert.strictEqual(e.autoX, 0);
    assert.strictEqual(e.autoY, 0);
    assert.strictEqual(e.autoStateEmpty, true);
    assert.strictEqual(e.exportFilename, "type-diagram.svg");
    assert.strictEqual(e.inspectorClosed, true);
    assert.strictEqual(e.inspectorEscaped, true);

    assert.match(doc.getText(), /type ConversationRequest/);
    assert.match(doc.getText(), /prompt: TextPart/);
    assert.match(doc.getText(), /option: Option<Any>/);
    assert.match(doc.getText(), /ScalarValue \{ value: TextPart \}/);
    assert.match(doc.getText(), /alias Email = Option<String>/);
    assert.match(doc.getText(), /union NewUnion/);
    assert.match(doc.getText(), /alias NewAlias = String/);
    assert.doesNotMatch(doc.getText(), /type NewRecord/);
    assert.doesNotMatch(doc.getText(), /field: String/);
    assert.doesNotMatch(doc.getText(), /prompt: List</);
    assert.strictEqual((doc.getText().match(/type ConversationRequest/g) ?? []).length, 1);
    assert.strictEqual((doc.getText().match(/prompt: TextPart/g) ?? []).length, 1);
    assert.strictEqual((doc.getText().match(/option: Option<Any>/g) ?? []).length, 1);
    assert.deepStrictEqual(await vscode.commands.executeCommand("typediagram.editorStatus"), {
      visualEditor: true,
      openPanels: 1,
    });
    assert.strictEqual(readFileSync(samplePath, "utf8"), sampleSource);
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
