union Level {
  Low
  High
}
type Tag {
  key: String
  weight: Float
}
type Report {
  flags: List<Bool>
  counts: List<Int>
  ratios: List<Float>
  names: List<String>
  blobs: List<Bytes>
  tags: List<Tag>
  levels: List<Level>
  maybeCounts: Option<List<Int>>
  maybeTags: Option<List<Tag>>
  maybeLevels: Option<List<Level>>
  title: String
}
