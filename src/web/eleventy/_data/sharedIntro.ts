// [WEB-SHARED-INTRO] Renders docs/shared/intro.md once and exposes the HTML to every template.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTRO_PATH = resolve(__dirname, "../../../../docs/shared/intro.md");

const marked = new Marked();

export default marked.parse(readFileSync(INTRO_PATH, "utf-8")) as string;
