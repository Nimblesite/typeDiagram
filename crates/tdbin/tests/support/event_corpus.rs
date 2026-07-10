//! Union-heavy diagram-event benchmark fixture.

use tdbin::{DecodeError, EncodeError, Reader, Struct, Writer};

use super::documents;

/// Number of events in the event-stream fixture.
pub const EVENT_COUNT: usize = 2_048;

/// TDBIN event-stream envelope.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchEventBatch {
    /// Ordered diagram events.
    pub events: Vec<BenchEvent>,
}

/// TDBIN diagram event union.
#[derive(Debug, Clone, PartialEq)]
pub enum BenchEvent {
    /// A node was created.
    NodeCreated(BenchNodeCreated),
    /// A node moved.
    NodeMoved(BenchNodeMoved),
    /// An edge was added.
    EdgeAdded(BenchEdgeAdded),
    /// The current selection changed.
    SelectionChanged(BenchSelectionChanged),
    /// The viewport changed.
    ViewChanged(BenchViewChanged),
    /// An event-stream heartbeat with no payload.
    Heartbeat,
}

/// TDBIN node-created payload.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchNodeCreated {
    /// Owning document identifier.
    pub document_id: String,
    /// Created node.
    pub node: documents::BenchNode,
}

/// TDBIN node-moved payload.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchNodeMoved {
    /// Owning document identifier.
    pub document_id: String,
    /// Moved node identifier.
    pub node_id: String,
    /// New horizontal position.
    pub x: f64,
    /// New vertical position.
    pub y: f64,
}

/// TDBIN edge-added payload.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchEdgeAdded {
    /// Owning document identifier.
    pub document_id: String,
    /// Added edge.
    pub edge: documents::BenchEdge,
}

/// TDBIN selection-changed payload.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchSelectionChanged {
    /// Owning document identifier.
    pub document_id: String,
    /// Selected node identifiers.
    pub node_ids: Vec<String>,
    /// Selected edge identifiers.
    pub edge_ids: Vec<String>,
}

/// TDBIN view-changed payload.
#[derive(Debug, Clone, PartialEq)]
pub struct BenchViewChanged {
    /// Owning document identifier.
    pub document_id: String,
    /// View zoom factor.
    pub zoom: f64,
    /// Horizontal viewport offset.
    pub offset_x: f64,
    /// Vertical viewport offset.
    pub offset_y: f64,
}

impl Struct for BenchEventBatch {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.child_list(at, Self::DATA_WORDS, 0, Some(&self.events))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            events: r.child_list(at, Self::DATA_WORDS, 0)?.unwrap_or_default(),
        })
    }
}

impl Struct for BenchEvent {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        match self {
            Self::NodeCreated(payload) => write_payload(w, at, 0, payload),
            Self::NodeMoved(payload) => write_payload(w, at, 1, payload),
            Self::EdgeAdded(payload) => write_payload(w, at, 2, payload),
            Self::SelectionChanged(payload) => write_payload(w, at, 3, payload),
            Self::ViewChanged(payload) => write_payload(w, at, 4, payload),
            Self::Heartbeat => {
                w.scalar(at, 0, 5)?;
                w.child::<BenchNodeMoved>(at, Self::DATA_WORDS, 0, None)
            }
        }
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        match r.scalar(at, 0)? {
            0 => Ok(Self::NodeCreated(required_child(r, at)?)),
            1 => Ok(Self::NodeMoved(required_child(r, at)?)),
            2 => Ok(Self::EdgeAdded(required_child(r, at)?)),
            3 => Ok(Self::SelectionChanged(required_child(r, at)?)),
            4 => Ok(Self::ViewChanged(required_child(r, at)?)),
            5 => {
                r.require_null_pointer(at, 0)?;
                Ok(Self::Heartbeat)
            }
            ordinal => Err(DecodeError::UnknownVariant { ordinal }),
        }
    }
}

impl Struct for BenchNodeCreated {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 2;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.document_id))?;
        w.child(at, Self::DATA_WORDS, 1, Some(&self.node))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            document_id: required_string(r, at, Self::DATA_WORDS, 0)?,
            node: r
                .child(at, Self::DATA_WORDS, 1)?
                .ok_or(DecodeError::UnexpectedNull)?,
        })
    }
}

impl Struct for BenchNodeMoved {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 2;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.document_id))?;
        w.string(at, Self::DATA_WORDS, 1, Some(&self.node_id))?;
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.x))?;
        w.scalar(at, 1, tdbin::scalar::f64_bits(self.y))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            document_id: required_string(r, at, Self::DATA_WORDS, 0)?,
            node_id: required_string(r, at, Self::DATA_WORDS, 1)?,
            x: tdbin::scalar::f64_from(r.scalar(at, 0)?),
            y: tdbin::scalar::f64_from(r.scalar(at, 1)?),
        })
    }
}

impl Struct for BenchEdgeAdded {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 2;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.document_id))?;
        w.child(at, Self::DATA_WORDS, 1, Some(&self.edge))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            document_id: required_string(r, at, Self::DATA_WORDS, 0)?,
            edge: r
                .child(at, Self::DATA_WORDS, 1)?
                .ok_or(DecodeError::UnexpectedNull)?,
        })
    }
}

impl Struct for BenchSelectionChanged {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 3;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.document_id))?;
        w.string_list(at, Self::DATA_WORDS, 1, Some(&self.node_ids))?;
        w.string_list(at, Self::DATA_WORDS, 2, Some(&self.edge_ids))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            document_id: required_string(r, at, Self::DATA_WORDS, 0)?,
            node_ids: r.string_list(at, Self::DATA_WORDS, 1)?.unwrap_or_default(),
            edge_ids: r.string_list(at, Self::DATA_WORDS, 2)?.unwrap_or_default(),
        })
    }
}

impl Struct for BenchViewChanged {
    const DATA_WORDS: u16 = 3;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.document_id))?;
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.zoom))?;
        w.scalar(at, 1, tdbin::scalar::f64_bits(self.offset_x))?;
        w.scalar(at, 2, tdbin::scalar::f64_bits(self.offset_y))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            document_id: required_string(r, at, Self::DATA_WORDS, 0)?,
            zoom: tdbin::scalar::f64_from(r.scalar(at, 0)?),
            offset_x: tdbin::scalar::f64_from(r.scalar(at, 1)?),
            offset_y: tdbin::scalar::f64_from(r.scalar(at, 2)?),
        })
    }
}

/// Protobuf mirror types for the event fixture.
pub mod pb {
    use super::documents;

    /// Protobuf event-stream envelope.
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchEventBatch {
        /// Ordered diagram events.
        #[prost(message, repeated, tag = "1")]
        pub events: Vec<BenchEventEnvelope>,
    }

    /// Protobuf envelope for one event union.
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchEventEnvelope {
        /// Event payload.
        #[prost(oneof = "BenchEvent", tags = "1, 2, 3, 4, 5, 6")]
        pub event: Option<BenchEvent>,
    }

    /// Protobuf event oneof.
    #[derive(Clone, PartialEq, prost::Oneof)]
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
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchNodeCreated {
        /// Owning document identifier.
        #[prost(string, tag = "1")]
        pub document_id: String,
        /// Created node.
        #[prost(message, optional, tag = "2")]
        pub node: Option<documents::pb::BenchNode>,
    }

    /// Protobuf node-moved payload.
    #[derive(Clone, PartialEq, prost::Message)]
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
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct BenchEdgeAdded {
        /// Owning document identifier.
        #[prost(string, tag = "1")]
        pub document_id: String,
        /// Added edge.
        #[prost(message, optional, tag = "2")]
        pub edge: Option<documents::pb::BenchEdge>,
    }

    /// Protobuf selection-changed payload.
    #[derive(Clone, PartialEq, prost::Message)]
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
    #[derive(Clone, PartialEq, prost::Message)]
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
    #[derive(Clone, Copy, PartialEq, prost::Message)]
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

/// Write a payload-carrying union variant through the shared pointer slot.
fn write_payload<T: Struct>(
    w: &mut Writer,
    at: usize,
    ordinal: u64,
    payload: &T,
) -> Result<(), EncodeError> {
    w.scalar(at, 0, ordinal)?;
    w.child(at, BenchEvent::DATA_WORDS, 0, Some(payload))
}

/// Read a required union payload from the shared pointer slot.
fn required_child<T: Struct>(r: &Reader<'_>, at: usize) -> Result<T, DecodeError> {
    r.child(at, BenchEvent::DATA_WORDS, 0)?
        .ok_or(DecodeError::UnexpectedNull)
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
