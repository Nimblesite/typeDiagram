type BenchDocument {
  id: String
  title: String
  revision: Int
  nodes: List<BenchNode>
  edges: List<BenchEdge>
  styles: List<BenchStyle>
  metadata: List<BenchMeta>
}

type BenchNode {
  id: String
  label: String
  x: Float
  y: Float
  width: Float
  height: Float
  selected: Bool
  locked: Bool
  tags: List<String>
}

type BenchEdge {
  id: String
  from: String
  to: String
  label: Option<String>
  weight: Float
  directed: Bool
}

type BenchStyle {
  selector: String
  fill: String
  stroke: String
  strokeWidth: Float
  rounded: Bool
}

type BenchMeta {
  key: String
  value: String
}

union BenchEvent {
  NodeCreated(BenchNodeCreated)
  NodeMoved(BenchNodeMoved)
  EdgeAdded(BenchEdgeAdded)
  SelectionChanged(BenchSelectionChanged)
  ViewChanged(BenchViewChanged)
  Heartbeat
}

type BenchEventBatch {
  events: List<BenchEvent>
}

type BenchNodeCreated {
  documentId: String
  node: BenchNode
}

type BenchNodeMoved {
  documentId: String
  nodeId: String
  x: Float
  y: Float
}

type BenchEdgeAdded {
  documentId: String
  edge: BenchEdge
}

type BenchSelectionChanged {
  documentId: String
  nodeIds: List<String>
  edgeIds: List<String>
}

type BenchViewChanged {
  documentId: String
  zoom: Float
  offsetX: Float
  offsetY: Float
}

type BenchMetricBatch {
  batchId: String
  startedAtEpochMs: Int
  sampleIds: List<Int>
  valid: List<Bool>
  latencyMs: List<Float>
  payloads: List<Bytes>
  columns: List<BenchMetricColumn>
}

type BenchMetricColumn {
  name: String
  values: List<Float>
}
