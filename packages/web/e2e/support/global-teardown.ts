// [WEB-E2E-COVERAGE-TEARDOWN] Generate the final coverage report ONCE after
// all specs have run. The per-test fixture accumulates raw V8 data into MCR's
// cache; this teardown emits json-summary + v8 HTML reports from it.
import MCR from "monocart-coverage-reports";
import { coverageOptions } from "./coverage-fixture.js";

export default async function globalTeardown(): Promise<void> {
  const mcr = MCR(coverageOptions);
  await mcr.generate();
}
