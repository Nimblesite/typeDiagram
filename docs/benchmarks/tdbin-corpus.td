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
  stroke_width: Float
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
  document_id: String
  node: BenchNode
}

type BenchNodeMoved {
  document_id: String
  node_id: String
  x: Float
  y: Float
}

type BenchEdgeAdded {
  document_id: String
  edge: BenchEdge
}

type BenchSelectionChanged {
  document_id: String
  node_ids: List<String>
  edge_ids: List<String>
}

type BenchViewChanged {
  document_id: String
  zoom: Float
  offset_x: Float
  offset_y: Float
}

type BenchMetricBatch {
  batch_id: String
  started_at_epoch_ms: Int
  sample_ids: List<Int>
  valid: List<Bool>
  latency_ms: List<Float>
  payloads: List<Bytes>
  columns: List<BenchMetricColumn>
}

type BenchMetricColumn {
  name: String
  values: List<Float>
}
