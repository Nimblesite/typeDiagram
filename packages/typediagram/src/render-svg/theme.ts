export type ThemeName = "light" | "dark";

export interface Theme {
  bg: string;
  nodeFill: string;
  nodeStroke: string;
  headerFill: string;
  headerText: string;
  /** [RENDER-UNION-ONEOF] Distinct fill for union headers. */
  unionHeaderFill: string;
  /** [RENDER-UNION-ONEOF] "one of" badge text color. */
  unionBadgeText: string;
  rowText: string;
  rowDivider: string;
  edgeStroke: string;
  edgeText: string;
  unionAccent: string;
  aliasAccent: string;
  recordAccent: string;
  fontFamily: string;
}

export const LIGHT: Theme = {
  bg: "#f6f8fc",
  nodeFill: "#ffffff",
  nodeStroke: "#c5ced8",
  headerFill: "#e6ecf4",
  headerText: "#0b1326",
  unionHeaderFill: "#eee5f8",
  unionBadgeText: "#7a3fd1",
  rowText: "#26384d",
  rowDivider: "#d8e0eb",
  edgeStroke: "#60758a",
  edgeText: "#3a4a5c",
  unionAccent: "#7a3fd1",
  aliasAccent: "#0f8a7a",
  recordAccent: "#0c7bb8",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const DARK: Theme = {
  bg: "#0b1326",
  nodeFill: "#222a3d",
  nodeStroke: "#3e484f",
  headerFill: "#2d3449",
  headerText: "#dae2fd",
  unionHeaderFill: "#342a49",
  unionBadgeText: "#ddb7ff",
  rowText: "#bdc8d1",
  rowDivider: "#31394d",
  edgeStroke: "#87929a",
  edgeText: "#bdc8d1",
  unionAccent: "#ddb7ff",
  aliasAccent: "#45e3ce",
  recordAccent: "#8ed5ff",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export function getTheme(name: ThemeName): Theme {
  return name === "dark" ? DARK : LIGHT;
}
