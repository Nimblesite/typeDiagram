import MarkdownIt from "markdown-it";
import { readFileSync } from "node:fs";

// Bundled extension - does it even export extendMarkdownIt?
const extDistPath = "/Users/christianfindlay/Documents/Code/type_model/packages/vscode/dist/extension.js";
const mod = await import(extDistPath);
console.log("bundled extension exports:", Object.keys(mod));

const docMd = readFileSync("/Users/christianfindlay/Documents/Code/type_model/packages/vscode/examples/doc.md", "utf8");

if (mod.extendMarkdownIt) {
  const md = new MarkdownIt();
  mod.extendMarkdownIt(md);
  // Wait for warmup
  await new Promise(r => setTimeout(r, 1000));
  const html = md.render(docMd);
  console.log("HTML length:", html.length);
  console.log("Contains <svg:", html.includes("<svg"));
  console.log("Contains typediagram-pending:", html.includes("typediagram-pending"));
  console.log("HTML head:", html.slice(0, 500));
}
