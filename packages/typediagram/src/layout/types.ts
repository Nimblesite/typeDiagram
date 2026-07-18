export interface NodeBox {
  /** Unique node id (decl name for top-level nodes). */
  id: string;
  /** Decl name. */
  declName: string;
  /** Decl kind for renderer dispatch. */
  declKind: "record" | "union" | "alias" | "function";
  /** Pixel position (top-left). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Header text (e.g. "User", "Option<T>"). */
  header: string;
  /** Rows: fields for records, variants for unions, single target for aliases. */
  rows: NodeRow[];
}

export interface NodeRow {
  /** Display text for the row. */
  text: string;
  /** Y offset within the node (top of the row). */
  y: number;
  /** Row height. */
  height: number;
  /** For union variants only: nested fields rendered inside the variant block. */
  nested?: NodeRow[];
}

export interface EdgeRoute {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** Polyline points (orthogonal). */
  points: Array<{ x: number; y: number }>;
  /** Display label, may be empty. */
  label: string;
  kind: "field" | "variantPayload" | "genericArg" | "parameter" | "return";
}

export interface LaidOutGraph {
  width: number;
  height: number;
  nodes: NodeBox[];
  edges: EdgeRoute[];
}

export interface LayoutOpts {
  fontSize?: number;
  /** Padding inside each node row. */
  rowPaddingX?: number;
  /** Vertical row padding. */
  rowPaddingY?: number;
}
