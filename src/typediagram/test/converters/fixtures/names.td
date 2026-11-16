# [TDBIN-CODEGEN-LOCALS] Field and variant names that collide with the
# generated codecs' own identifiers: Rust `w`/`r`/`at`/`count`/`items`/`rows`/
# `i`/`tags`, TypeScript `value`/`writer`/`reader`/`tdbin`/`ok`, and helper
# suffixes (`x` next to `xPresent`). Codegen must never let them shadow.
type Inner {
  at: Int
  r: String
}

union Pick {
  W(Inner)
  Items(Inner)
  Tags
  Count(Inner)
}

type Names {
  value: String
  writer: Int
  reader: Int
  tdbin: Int
  ok: Bool
  w: Int
  at: Int
  r: Int
  count: Int
  i: Bool
  items: Option<Inner>
  rows: List<Inner>
  tags: List<String>
  x: Option<Int>
  xPresent: Option<Int>
  pick: Pick
}

type NamesBatch {
  names: List<Names>
  picks: List<Pick>
}
