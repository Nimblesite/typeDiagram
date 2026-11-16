// [WEB-MAIN] Landing page + embedded playground.
import { mountPlayground } from "./playground.js";

const el = document.getElementById("playground-mount");
if (el !== null) {
  mountPlayground(el);
} else {
  console.error("[WEB-MAIN] missing #playground-mount");
}
