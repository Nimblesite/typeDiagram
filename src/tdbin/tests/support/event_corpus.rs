//! Union-heavy diagram-event benchmark fixture.

use super::documents;
use super::generated_corpus::{
    BenchEdgeAdded, BenchEvent, BenchEventBatch, BenchNodeCreated, BenchNodeMoved,
    BenchSelectionChanged, BenchViewChanged,
};

/// Number of events in the event-stream fixture.
pub const EVENT_COUNT: usize = 2_048;

/// Protobuf mirror types for the event fixture.
pub mod pb {
    use super::documents;

    /// Protobuf event-stream envelope.
    #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
    pub struct BenchEventBatch {
        /// Ordered diagram events.
        #[prost(message, repeated, tag = "1")]
        pub events: Vec<BenchEventEnvelope>,
    }

    /// Protobuf envelope for one event union.
    #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
    pub struct BenchEventEnvelope {
        /// Event payload.
        #[prost(oneof = "BenchEvent", tags = "1, 2, 3, 4, 5, 6")]
        pub event: Option<BenchEvent>,
    }

    /// Protobuf event oneof.
    #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Oneof)]
    pub enum BenchEvent {
        /// A node was created.
        #[prost(message, tag = "1")]
        NodeCreated(BenchNodeCreated),
        /// A node moved.
        #[prost(message, tag = "2")]
        NodeMoved(BenchNodeMoved),
        /// An edge was added.
        #[prost(message, tag = "3")]
        EdgeAdded(BenchEdgeAdded),
        /// The current selection changed.
        #[prost(message, tag = "4")]
        SelectionChanged(BenchSelectionChanged),
        /// The viewport changed.
        #[prost(message, tag = "5")]
        ViewChanged(BenchViewChanged),
        /// An event-stream heartbeat with no payload.
        #[prost(message, tag = "6")]
        Heartbeat(BenchHeartbeat),
    }

    /// Protobuf node-created payload.
    #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
    pub struct BenchNodeCreated {
        /// Owning document identifier.
        #[prost(string, tag = "1")]
        pub document_id: String,
        /// Created node.
        #[prost(message, optional, tag = "2")]
        pub node: Option<documents::pb::BenchNode>,
    }

    /// Protobuf node-moved payload.
    #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
    pub struct BenchNodeMoved {
        /// Owning document identifier.
        #[prost(string, tag = "1")]
        pub document_id: String,
        /// Moved node identifier.
        #[prost(string, tag = "2")]
        pub node_id: String,
        /// New horizontal position.
        #[prost(double, tag = "3")]
        pub x: f64,
        /// New vertical position.
        #[prost(double, tag = "4")]
        pub y: f64,
    }

    /// Protobuf edge-added payload.
    #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
    pub struct BenchEdgeAdded {
        /// Owning document identifier.
        #[prost(string, tag = "1")]
        pub document_id: String,
        /// Added edge.
        #[prost(message, optional, tag = "2")]
        pub edge: Option<documents::pb::BenchEdge>,
    }

    /// Protobuf selection-changed payload.
    #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
    pub struct BenchSelectionChanged {
        /// Owning document identifier.
        #[prost(string, tag = "1")]
        pub document_id: String,
        /// Selected node identifiers.
        #[prost(string, repeated, tag = "2")]
        pub node_ids: Vec<String>,
        /// Selected edge identifiers.
        #[prost(string, repeated, tag = "3")]
        pub edge_ids: Vec<String>,
    }

    /// Protobuf view-changed payload.
    #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
    pub struct BenchViewChanged {
        /// Owning document identifier.
        #[prost(string, tag = "1")]
        pub document_id: String,
        /// View zoom factor.
        #[prost(double, tag = "2")]
        pub zoom: f64,
        /// Horizontal viewport offset.
        #[prost(double, tag = "3")]
        pub offset_x: f64,
        /// Vertical viewport offset.
        #[prost(double, tag = "4")]
        pub offset_y: f64,
    }

    /// Protobuf empty heartbeat payload.
    #[derive(serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, prost::Message)]
    pub struct BenchHeartbeat {}
}

/// Build the TDBIN event-stream fixture.
#[must_use]
pub fn td_event_batch() -> BenchEventBatch {
    BenchEventBatch {
        events: (0..EVENT_COUNT).map(td_event).collect(),
    }
}

/// Build the Protobuf event-stream fixture with identical logical values.
#[must_use]
pub fn pb_event_batch() -> pb::BenchEventBatch {
    pb::BenchEventBatch {
        events: (0..EVENT_COUNT).map(pb_event).collect(),
    }
}

/// Build one deterministic TDBIN event.
fn td_event(index: usize) -> BenchEvent {
    match index % 6 {
        0 => BenchEvent::NodeCreated(BenchNodeCreated {
            document_id: document_id(),
            node: documents::td_node(index % documents::NODE_COUNT),
        }),
        1 => BenchEvent::NodeMoved(BenchNodeMoved {
            document_id: document_id(),
            node_id: node_id(index),
            x: event_float(index, 17),
            y: event_float(index, 29),
        }),
        2 => BenchEvent::EdgeAdded(BenchEdgeAdded {
            document_id: document_id(),
            edge: documents::td_edge(index % documents::EDGE_COUNT),
        }),
        3 => BenchEvent::SelectionChanged(BenchSelectionChanged {
            document_id: document_id(),
            node_ids: selection_node_ids(index),
            edge_ids: vec![format!("edge-{:04}", index % documents::EDGE_COUNT)],
        }),
        4 => BenchEvent::ViewChanged(BenchViewChanged {
            document_id: document_id(),
            zoom: 1.0 + event_float(index, 10) / 100.0,
            offset_x: event_float(index, 31),
            offset_y: event_float(index, 43),
        }),
        _ => BenchEvent::Heartbeat,
    }
}

/// Build one deterministic Protobuf event with identical values.
fn pb_event(index: usize) -> pb::BenchEventEnvelope {
    let event = match index % 6 {
        0 => pb::BenchEvent::NodeCreated(pb::BenchNodeCreated {
            document_id: document_id(),
            node: Some(documents::pb_node(index % documents::NODE_COUNT)),
        }),
        1 => pb::BenchEvent::NodeMoved(pb::BenchNodeMoved {
            document_id: document_id(),
            node_id: node_id(index),
            x: event_float(index, 17),
            y: event_float(index, 29),
        }),
        2 => pb::BenchEvent::EdgeAdded(pb::BenchEdgeAdded {
            document_id: document_id(),
            edge: Some(documents::pb_edge(index % documents::EDGE_COUNT)),
        }),
        3 => pb::BenchEvent::SelectionChanged(pb::BenchSelectionChanged {
            document_id: document_id(),
            node_ids: selection_node_ids(index),
            edge_ids: vec![format!("edge-{:04}", index % documents::EDGE_COUNT)],
        }),
        4 => pb::BenchEvent::ViewChanged(pb::BenchViewChanged {
            document_id: document_id(),
            zoom: 1.0 + event_float(index, 10) / 100.0,
            offset_x: event_float(index, 31),
            offset_y: event_float(index, 43),
        }),
        _ => pb::BenchEvent::Heartbeat(pb::BenchHeartbeat {}),
    };
    pb::BenchEventEnvelope { event: Some(event) }
}

/// Return the shared fixture document identifier.
fn document_id() -> String {
    "diagram-benchmark-2026".to_owned()
}

/// Return one deterministic node identifier.
fn node_id(index: usize) -> String {
    format!("node-{:04}", index % documents::NODE_COUNT)
}

/// Return the deterministic three-node selection for one event.
fn selection_node_ids(index: usize) -> Vec<String> {
    vec![
        node_id(index),
        node_id(index.saturating_add(1)),
        node_id(index.saturating_add(2)),
    ]
}

/// Convert a deterministic bounded integer to f64.
fn event_float(index: usize, multiplier: usize) -> f64 {
    let value = index.saturating_mul(multiplier) % 4096;
    f64::from(u32::try_from(value).unwrap_or(0)) + 0.5
}
