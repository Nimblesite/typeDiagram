// [CLI-SNAPSHOT-SCENARIOS] SVG snapshot tests — delegates to shared scenario runner.
// Same scenarios and assertions as web. If rendering changes, .svg files diff.
import { runSnapshotScenarios } from "../../typediagram/test/run-scenarios.js";

runSnapshotScenarios("CLI-SNAPSHOT-SCENARIOS", "./__snapshots__");
