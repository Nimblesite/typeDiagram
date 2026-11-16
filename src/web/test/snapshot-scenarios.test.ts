// [WEB-SNAPSHOT-SCENARIOS] SVG snapshot tests — delegates to shared scenario runner.
// Same scenarios and assertions as CLI. If rendering changes, .svg files diff.
import { runSnapshotScenarios } from "../../typediagram/test/run-scenarios.js";

runSnapshotScenarios("WEB-SNAPSHOT-SCENARIOS", "./__snapshots__");
