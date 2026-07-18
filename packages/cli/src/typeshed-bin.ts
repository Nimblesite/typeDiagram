#!/usr/bin/env node
// [TYPESHED-BULK-BIN] Dedicated typeshed repository converter entry point.
import { typeshedMain } from "./typeshed-cli.js";

void typeshedMain(process.argv.slice(2), process.stdout, process.stderr).then((code) => process.exit(code));
