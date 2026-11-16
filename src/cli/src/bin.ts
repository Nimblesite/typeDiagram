#!/usr/bin/env node
// [CLI-BIN] Entry point for the typediagram CLI binary. Sets `process.exitCode`
// rather than calling `process.exit()`: exit() terminates before Node drains
// pending stdout writes, silently truncating piped output larger than one
// synchronous pipe write (issue #48).
import { main } from "./cli.js";

void main(process.argv.slice(2), process.stdout, process.stderr).then((code) => {
  process.exitCode = code;
});
