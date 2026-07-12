//! Record-heavy diagram-document benchmark fixture.

use super::generated_corpus::{BenchDocument, BenchEdge, BenchMeta, BenchNode, BenchStyle};

/// Number of nodes in the document fixture.
pub const NODE_COUNT: usize = 256;
/// Number of edges in the document fixture.
pub const EDGE_COUNT: usize = 512;
/// Number of style rules in the document fixture.
const STYLE_COUNT: usize = 8;
/// Number of metadata entries in the document fixture.
const META_COUNT: usize = 16;

/// Protobuf mirror types for the document fixture.
pub mod pb {
    /// Protobuf diagram document.
    #[derive(serde::Serialize, serde::Deserialize)]
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
    #[derive(serde::Serialize, serde::Deserialize)]
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
    #[derive(serde::Serialize, serde::Deserialize)]
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
    #[derive(serde::Serialize, serde::Deserialize)]
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
    #[derive(serde::Serialize, serde::Deserialize)]
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

/// Generate a deterministic floating-point coordinate.
fn coordinate(index: usize, multiplier: usize) -> f64 {
    small_float(index.saturating_mul(multiplier), 1024) + 0.25
}

/// Convert a bounded integer remainder to f64 without unchecked casts.
fn small_float(value: usize, modulus: usize) -> f64 {
    f64::from(u32::try_from(value.checked_rem(modulus).unwrap_or(0)).unwrap_or(0))
}
