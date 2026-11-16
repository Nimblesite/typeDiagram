// [WEB-CONV-MAIN] Entry point for the converter page.
import { mountConverter } from "./converter.js";

const el = document.getElementById("converter-mount");
if (el !== null) {
  mountConverter(el);
} else {
  console.error("[WEB-CONV-MAIN] missing #converter-mount");
}
