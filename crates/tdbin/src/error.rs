//! Error types for the TDBIN codec. Failures are values, never panics
//! ([TDBIN-RS-NOPANIC]); no variant carries payload bytes ([TDBIN-RS-ERROR]).

use core::fmt;

/// Errors returned while encoding a typed value to TDBIN bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum EncodeError {
    /// A body was not aligned to the 8-byte word size required by TDBIN.
    BadLength,
    /// A section, offset, or message exceeded a wire-format limit
    /// ([TDBIN-WIRE-LIMITS]).
    LimitExceeded,
    /// A relative pointer offset did not fit the signed 30-bit field
    /// ([TDBIN-PTR-STRUCT]).
    OffsetOutOfRange,
}

impl fmt::Display for EncodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            Self::BadLength => "body length is not word-aligned",
            Self::LimitExceeded => "value exceeds a TDBIN wire-format limit",
            Self::OffsetOutOfRange => "pointer offset does not fit the signed 30-bit field",
        };
        f.write_str(msg)
    }
}

impl std::error::Error for EncodeError {}

/// Errors returned while decoding TDBIN bytes to a typed value. Safe on
/// arbitrary untrusted input ([TDBIN-SAFE]).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum DecodeError {
    /// Frame magic did not match `TDB1` ([TDBIN-MSG-FRAME]).
    BadMagic,
    /// Frame version is not supported ([TDBIN-MSG-FRAME]).
    BadVersion {
        /// Version byte read from the frame header.
        version: u8,
    },
    /// Reserved frame flag bits or fields were nonzero ([TDBIN-MSG-FRAME]).
    ReservedBits,
    /// Frame body length did not match the available bytes ([TDBIN-MSG-FRAME]).
    LengthMismatch,
    /// A framed message did not carry the expected layout hash.
    HashMismatch {
        /// Layout hash required by the typed decoder.
        expected: u64,
        /// Layout hash present on the frame, or `None` when omitted.
        got: Option<u64>,
    },
    /// A packed body ended mid-element ([TDBIN-PACK]).
    PackedTruncated,
    /// Wire length was zero or not a multiple of the 8-byte word size.
    BadLength,
    /// A pointer referenced a word outside the message body
    /// ([TDBIN-SAFE-BOUNDS]).
    PointerOutOfBounds {
        /// Word index that was out of range.
        word_index: usize,
    },
    /// A pointer used a reserved kind (far / RPC), invalid in v0
    /// ([TDBIN-PTR-RESERVED]).
    ReservedPointerKind,
    /// A pointer slot held a kind the field's type does not permit.
    PointerKindMismatch,
    /// A composite-list tag disagreed with the list pointer's word count.
    MalformedCompositeTag,
    /// Struct nesting exceeded the depth cap ([TDBIN-SAFE-DEPTH]).
    DepthExceeded,
    /// Traversal exceeded the amplification budget ([TDBIN-SAFE-AMPLIFY]).
    AmplificationExceeded,
    /// A string field held bytes that were not valid UTF-8
    /// ([TDBIN-SAFE-UTF8]).
    InvalidUtf8,
    /// A decoded count or length exceeded an addressable limit
    /// ([TDBIN-WIRE-LIMITS]).
    LimitExceeded,
    /// A union discriminant had no matching variant ([TDBIN-UNION-UNKNOWN]).
    UnknownVariant {
        /// The unrecognized discriminant ordinal.
        ordinal: u64,
    },
    /// A non-optional pointer field was null where a value was required.
    UnexpectedNull,
    /// The root pointer was null.
    NullRoot,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadMagic => f.write_str("frame magic is not TDB1"),
            Self::BadVersion { version } => {
                write!(f, "frame version {version} is not supported")
            }
            Self::ReservedBits => f.write_str("frame reserved bits or fields were nonzero"),
            Self::LengthMismatch => f.write_str("frame body length does not match available bytes"),
            Self::HashMismatch { expected, got } => {
                write!(f, "frame schema hash {got:?} does not match {expected:#x}")
            }
            Self::PackedTruncated => f.write_str("packed body ended mid-element"),
            Self::BadLength => f.write_str("wire length is zero or not word-aligned"),
            Self::PointerOutOfBounds { word_index } => {
                write!(f, "pointer references out-of-bounds word {word_index}")
            }
            Self::ReservedPointerKind => f.write_str("pointer used a reserved kind"),
            Self::PointerKindMismatch => f.write_str("pointer kind does not match the field type"),
            Self::MalformedCompositeTag => f.write_str("composite-list tag is malformed"),
            Self::DepthExceeded => f.write_str("struct nesting exceeded the depth cap"),
            Self::AmplificationExceeded => {
                f.write_str("traversal exceeded the amplification budget")
            }
            Self::InvalidUtf8 => f.write_str("string field held invalid UTF-8"),
            Self::LimitExceeded => f.write_str("decoded count exceeds an addressable limit"),
            Self::UnknownVariant { ordinal } => {
                write!(f, "union discriminant {ordinal} has no variant")
            }
            Self::UnexpectedNull => f.write_str("required pointer field was null"),
            Self::NullRoot => f.write_str("root pointer was null"),
        }
    }
}

impl std::error::Error for DecodeError {}
