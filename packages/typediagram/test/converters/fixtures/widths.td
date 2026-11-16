type Stats {
  delta: I32
  flags: U8
  port: U16
  hits: U32
  hash: U64
  count: Size
  file: Path
  maybeHash: Option<U64>
  maybePort: Option<U16>
  maybeFile: Option<Path>
  deltas: List<I32>
  bytes: List<U8>
  ports: List<U16>
  hitsList: List<U32>
  hashes: List<U64>
  sizes: List<Size>
  files: List<Path>
  maybeSizes: Option<List<Size>>
  maybeFiles: Option<List<Path>>
}
type StatsRaw {
  delta: Int
  flags: U64
  port: U64
  hits: U64
  hash: U64
  count: U64
}
