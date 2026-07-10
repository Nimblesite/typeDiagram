//! Record-heavy diagram-document benchmark fixture.

use tdbin::{DecodeError, EncodeError, Reader, Struct, Writer};

/// Number of nodes in the document fixture.
pub const NODE_COUNT: usize = 256;
/// Number of edges in the document fixture.
pub const EDGE_COUNT: usize = 512;
/// Number of style rules in the document fixture.
const STYLE_COUNT: usize = 8;
/// Number of metadata entries in the document fixture.
const META_COUNT: usize = 16;

/// TDBIN mirror of `BenchDocument` in `docs/benchmarks/tdbin-corpus.td`.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchDocument {
    /// Stable document identifier.
    pub id: String,
    /// Human-readable title.
    pub title: String,
    /// Document revision.
    pub revision: i64,
    /// Diagram nodes.
    pub nodes: Vec<BenchNode>,
    /// Diagram edges.
    pub edges: Vec<BenchEdge>,
    /// Style rules.
    pub styles: Vec<BenchStyle>,
    /// Metadata entries.
    pub metadata: Vec<BenchMeta>,
}

/// TDBIN diagram node.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchNode {
    /// Stable node identifier.
    pub id: String,
    /// Display label.
    pub label: String,
    /// Horizontal position.
    pub x: f64,
    /// Vertical position.
    pub y: f64,
    /// Rendered width.
    pub width: f64,
    /// Rendered height.
    pub height: f64,
    /// Selection state.
    pub selected: bool,
    /// Lock state.
    pub locked: bool,
    /// Search and grouping tags.
    pub tags: Vec<String>,
}

/// TDBIN diagram edge.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchEdge {
    /// Stable edge identifier.
    pub id: String,
    /// Source node identifier.
    pub from: String,
    /// Target node identifier.
    pub to: String,
    /// Optional display label.
    pub label: Option<String>,
    /// Edge weight.
    pub weight: f64,
    /// Direction state.
    pub directed: bool,
}

/// TDBIN style rule.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchStyle {
    /// Selector expression.
    pub selector: String,
    /// Fill color.
    pub fill: String,
    /// Stroke color.
    pub stroke: String,
    /// Stroke width.
    pub stroke_width: f64,
    /// Rounded-corner state.
    pub rounded: bool,
}

/// TDBIN metadata key/value pair.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchMeta {
    /// Metadata key.
    pub key: String,
    /// Metadata value.
    pub value: String,
}

impl Struct for BenchDocument {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 6;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.id))?;
        w.string(at, Self::DATA_WORDS, 1, Some(&self.title))?;
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.revision))?;
        w.child_list(at, Self::DATA_WORDS, 2, Some(&self.nodes))?;
        w.child_list(at, Self::DATA_WORDS, 3, Some(&self.edges))?;
        w.child_list(at, Self::DATA_WORDS, 4, Some(&self.styles))?;
        w.child_list(at, Self::DATA_WORDS, 5, Some(&self.metadata))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            id: required_string(r, at, Self::DATA_WORDS, 0)?,
            title: required_string(r, at, Self::DATA_WORDS, 1)?,
            revision: tdbin::scalar::i64_from(r.scalar(at, 0)?),
            nodes: r.child_list(at, Self::DATA_WORDS, 2)?.unwrap_or_default(),
            edges: r.child_list(at, Self::DATA_WORDS, 3)?.unwrap_or_default(),
            styles: r.child_list(at, Self::DATA_WORDS, 4)?.unwrap_or_default(),
            metadata: r.child_list(at, Self::DATA_WORDS, 5)?.unwrap_or_default(),
        })
    }
}

impl Struct for BenchNode {
    const DATA_WORDS: u16 = 5;
    const PTR_WORDS: u16 = 3;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.id))?;
        w.string(at, Self::DATA_WORDS, 1, Some(&self.label))?;
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.x))?;
        w.scalar(at, 1, tdbin::scalar::f64_bits(self.y))?;
        w.scalar(at, 2, tdbin::scalar::f64_bits(self.width))?;
        w.scalar(at, 3, tdbin::scalar::f64_bits(self.height))?;
        w.bool_bit(at, 4, 0, self.selected)?;
        w.bool_bit(at, 4, 1, self.locked)?;
        w.string_list(at, Self::DATA_WORDS, 2, Some(&self.tags))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            id: required_string(r, at, Self::DATA_WORDS, 0)?,
            label: required_string(r, at, Self::DATA_WORDS, 1)?,
            x: tdbin::scalar::f64_from(r.scalar(at, 0)?),
            y: tdbin::scalar::f64_from(r.scalar(at, 1)?),
            width: tdbin::scalar::f64_from(r.scalar(at, 2)?),
            height: tdbin::scalar::f64_from(r.scalar(at, 3)?),
            selected: r.bool_bit(at, 4, 0)?,
            locked: r.bool_bit(at, 4, 1)?,
            tags: r.string_list(at, Self::DATA_WORDS, 2)?.unwrap_or_default(),
        })
    }
}

impl Struct for BenchEdge {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 4;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.id))?;
        w.string(at, Self::DATA_WORDS, 1, Some(&self.from))?;
        w.string(at, Self::DATA_WORDS, 2, Some(&self.to))?;
        w.string(at, Self::DATA_WORDS, 3, self.label.as_deref())?;
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.weight))?;
        w.bool_bit(at, 1, 0, self.directed)
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            id: required_string(r, at, Self::DATA_WORDS, 0)?,
            from: required_string(r, at, Self::DATA_WORDS, 1)?,
            to: required_string(r, at, Self::DATA_WORDS, 2)?,
            label: r.string(at, Self::DATA_WORDS, 3)?,
            weight: tdbin::scalar::f64_from(r.scalar(at, 0)?),
            directed: r.bool_bit(at, 1, 0)?,
        })
    }
}

impl Struct for BenchStyle {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 3;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.selector))?;
        w.string(at, Self::DATA_WORDS, 1, Some(&self.fill))?;
        w.string(at, Self::DATA_WORDS, 2, Some(&self.stroke))?;
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.stroke_width))?;
        w.bool_bit(at, 1, 0, self.rounded)
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            selector: required_string(r, at, Self::DATA_WORDS, 0)?,
            fill: required_string(r, at, Self::DATA_WORDS, 1)?,
            stroke: required_string(r, at, Self::DATA_WORDS, 2)?,
            stroke_width: tdbin::scalar::f64_from(r.scalar(at, 0)?),
            rounded: r.bool_bit(at, 1, 0)?,
        })
    }
}

impl Struct for BenchMeta {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 2;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.key))?;
        w.string(at, Self::DATA_WORDS, 1, Some(&self.value))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            key: required_string(r, at, Self::DATA_WORDS, 0)?,
            value: required_string(r, at, Self::DATA_WORDS, 1)?,
        })
    }
}

/// Protobuf mirror types for the document fixture.
pub mod pb {
    /// Protobuf diagram document.
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchDocument {
        /// Stable document identifier.
        #[prost(string, tag = "1")]
        pub id: String,
        /// Human-readable title.
        #[prost(string, tag = "2")]
        pub title: String,
        /// Document revision.
        #[prost(int64, tag = "3")]
        pub revision: i64,
        /// Diagram nodes.
        #[prost(message, repeated, tag = "4")]
        pub nodes: Vec<BenchNode>,
        /// Diagram edges.
        #[prost(message, repeated, tag = "5")]
        pub edges: Vec<BenchEdge>,
        /// Style rules.
        #[prost(message, repeated, tag = "6")]
        pub styles: Vec<BenchStyle>,
        /// Metadata entries.
        #[prost(message, repeated, tag = "7")]
        pub metadata: Vec<BenchMeta>,
    }

    /// Protobuf diagram node.
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchNode {
        /// Stable node identifier.
        #[prost(string, tag = "1")]
        pub id: String,
        /// Display label.
        #[prost(string, tag = "2")]
        pub label: String,
        /// Horizontal position.
        #[prost(double, tag = "3")]
        pub x: f64,
        /// Vertical position.
        #[prost(double, tag = "4")]
        pub y: f64,
        /// Rendered width.
        #[prost(double, tag = "5")]
        pub width: f64,
        /// Rendered height.
        #[prost(double, tag = "6")]
        pub height: f64,
        /// Selection state.
        #[prost(bool, tag = "7")]
        pub selected: bool,
        /// Lock state.
        #[prost(bool, tag = "8")]
        pub locked: bool,
        /// Search and grouping tags.
        #[prost(string, repeated, tag = "9")]
        pub tags: Vec<String>,
    }

    /// Protobuf diagram edge.
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchEdge {
        /// Stable edge identifier.
        #[prost(string, tag = "1")]
        pub id: String,
        /// Source node identifier.
        #[prost(string, tag = "2")]
        pub from: String,
        /// Target node identifier.
        #[prost(string, tag = "3")]
        pub to: String,
        /// Optional display label.
        #[prost(string, optional, tag = "4")]
        pub label: Option<String>,
        /// Edge weight.
        #[prost(double, tag = "5")]
        pub weight: f64,
        /// Direction state.
        #[prost(bool, tag = "6")]
        pub directed: bool,
    }

    /// Protobuf style rule.
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchStyle {
        /// Selector expression.
        #[prost(string, tag = "1")]
        pub selector: String,
        /// Fill color.
        #[prost(string, tag = "2")]
        pub fill: String,
        /// Stroke color.
        #[prost(string, tag = "3")]
        pub stroke: String,
        /// Stroke width.
        #[prost(double, tag = "4")]
        pub stroke_width: f64,
        /// Rounded-corner state.
        #[prost(bool, tag = "5")]
        pub rounded: bool,
    }

    /// Protobuf metadata key/value pair.
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchMeta {
        /// Metadata key.
        #[prost(string, tag = "1")]
        pub key: String,
        /// Metadata value.
        #[prost(string, tag = "2")]
        pub value: String,
    }
}

/// Build the TDBIN document fixture.
#[must_use]
pub fn td_document() -> BenchDocument {
    BenchDocument {
        id: "diagram-benchmark-2026".to_owned(),
        title: "typeDiagram benchmark document".to_owned(),
        revision: 42,
        nodes: (0..NODE_COUNT).map(td_node).collect(),
        edges: (0..EDGE_COUNT).map(td_edge).collect(),
        styles: (0..STYLE_COUNT).map(td_style).collect(),
        metadata: (0..META_COUNT).map(td_meta).collect(),
    }
}

/// Build the Protobuf document fixture with identical logical values.
#[must_use]
pub fn pb_document() -> pb::BenchDocument {
    pb::BenchDocument {
        id: "diagram-benchmark-2026".to_owned(),
        title: "typeDiagram benchmark document".to_owned(),
        revision: 42,
        nodes: (0..NODE_COUNT).map(pb_node).collect(),
        edges: (0..EDGE_COUNT).map(pb_edge).collect(),
        styles: (0..STYLE_COUNT).map(pb_style).collect(),
        metadata: (0..META_COUNT).map(pb_meta).collect(),
    }
}

/// Build one deterministic TDBIN node for document and event fixtures.
#[must_use]
pub fn td_node(index: usize) -> BenchNode {
    BenchNode {
        id: format!("node-{index:04}"),
        label: format!("Service component {index}"),
        x: coordinate(index, 37),
        y: coordinate(index, 53),
        width: 120.0 + small_float(index, 7),
        height: 48.0 + small_float(index, 5),
        selected: index.is_multiple_of(11),
        locked: index.is_multiple_of(17),
        tags: vec!["component".to_owned(), format!("group-{}", index % 16)],
    }
}

/// Build one deterministic Protobuf node with identical values.
#[must_use]
pub fn pb_node(index: usize) -> pb::BenchNode {
    let node = td_node(index);
    pb::BenchNode {
        id: node.id,
        label: node.label,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        selected: node.selected,
        locked: node.locked,
        tags: node.tags,
    }
}

/// Build one deterministic TDBIN edge for document and event fixtures.
#[must_use]
pub fn td_edge(index: usize) -> BenchEdge {
    BenchEdge {
        id: format!("edge-{index:04}"),
        from: format!("node-{:04}", index % NODE_COUNT),
        to: format!(
            "node-{:04}",
            index
                .saturating_add(17)
                .checked_rem(NODE_COUNT)
                .unwrap_or(0)
        ),
        label: index
            .is_multiple_of(3)
            .then(|| format!("dependency {index}")),
        weight: 0.5 + small_float(index, 19),
        directed: !index.is_multiple_of(5),
    }
}

/// Build one deterministic Protobuf edge with identical values.
#[must_use]
pub fn pb_edge(index: usize) -> pb::BenchEdge {
    let edge = td_edge(index);
    pb::BenchEdge {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label: edge.label,
        weight: edge.weight,
        directed: edge.directed,
    }
}

/// Build one deterministic style rule.
fn td_style(index: usize) -> BenchStyle {
    BenchStyle {
        selector: format!(".group-{index}"),
        fill: format!(
            "#{:06x}",
            index.saturating_mul(0x01_03_07).saturating_add(0x10_20_30)
        ),
        stroke: format!(
            "#{:06x}",
            index.saturating_mul(0x01_01_01).saturating_add(0x90_80_70)
        ),
        stroke_width: 1.0 + small_float(index, 4),
        rounded: index.is_multiple_of(2),
    }
}

/// Build one deterministic Protobuf style rule.
fn pb_style(index: usize) -> pb::BenchStyle {
    let style = td_style(index);
    pb::BenchStyle {
        selector: style.selector,
        fill: style.fill,
        stroke: style.stroke,
        stroke_width: style.stroke_width,
        rounded: style.rounded,
    }
}

/// Build one deterministic metadata entry.
fn td_meta(index: usize) -> BenchMeta {
    BenchMeta {
        key: format!("metadata-key-{index}"),
        value: format!("benchmark metadata value {index}"),
    }
}

/// Build one deterministic Protobuf metadata entry.
fn pb_meta(index: usize) -> pb::BenchMeta {
    let meta = td_meta(index);
    pb::BenchMeta {
        key: meta.key,
        value: meta.value,
    }
}

/// Return a required string field or a typed null error.
fn required_string(
    r: &Reader<'_>,
    at: usize,
    data_words: u16,
    slot: u16,
) -> Result<String, DecodeError> {
    r.string(at, data_words, slot)?
        .ok_or(DecodeError::UnexpectedNull)
}

/// Generate a deterministic floating-point coordinate.
fn coordinate(index: usize, multiplier: usize) -> f64 {
    small_float(index.saturating_mul(multiplier), 1024) + 0.25
}

/// Convert a bounded integer remainder to f64 without unchecked casts.
fn small_float(value: usize, modulus: usize) -> f64 {
    f64::from(u32::try_from(value.checked_rem(modulus).unwrap_or(0)).unwrap_or(0))
}
