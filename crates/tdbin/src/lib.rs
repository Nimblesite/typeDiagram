//! TDBIN: a compact binary codec for typeDiagram algebraic data types
//! (records + tagged unions). This crate is the Rust runtime that
//! **typeDiagram-generated ADT code targets**: a typed value encodes
//! straight to bytes and decodes straight back, with no intermediate
//! dynamic representation — binary <-> typed object, both directions
//! ([TDBIN-RS-API]).
//!
//! The reflective schema model (`TypeDef`/`TypeRef`) is deliberately NOT
//! part of this path; it is an optional tooling feature layered on top.
//! Serialization needs only the fixed layout the generated `impl Struct`
//! bakes in.
//!
//! The wire format is specified in `docs/specs/tdbin-wire-format.md`; this
//! crate implements the v0 subset (bare framing, unpacked) proving the
//! round-trip. Every item references its `[TDBIN-*]` spec ID.

mod error;
pub mod frame;
mod layout;
pub mod pack;
mod pointer;
mod reader;
pub mod reflect;
mod verify;
mod writer;

pub mod scalar;

pub use error::{DecodeError, EncodeError};
pub use reader::Reader;
pub use writer::Writer;

/// Maximum struct-nesting depth accepted by the decoder ([TDBIN-SAFE-DEPTH]).
pub(crate) const MAX_DEPTH: u32 = 64;

/// A type laid out on the wire as a struct: a fixed data section (scalars)
/// followed by a pointer section (strings, byte lists, nested structs,
/// unions).
///
/// typeDiagram codegen emits one `impl Struct` per generated record and
/// union; the constants and methods here are exactly what it fills in
/// ([TDBIN-REC-ALLOC], [TDBIN-UNION-STRUCT]). The layout is fixed at
/// generation time — never recomputed at encode/decode.
pub trait Struct: Sized {
    /// Number of 8-byte words in the data (scalar) section ([TDBIN-REC-ALLOC]).
    const DATA_WORDS: u16;
    /// Number of pointer slots in the pointer section ([TDBIN-REC-SECTIONS]).
    const PTR_WORDS: u16;

    /// Total body words (data + pointer sections); `None` on overflow.
    #[must_use]
    fn body_words() -> Option<usize> {
        usize::from(Self::DATA_WORDS).checked_add(usize::from(Self::PTR_WORDS))
    }

    /// Write this value into the struct body starting at word `at`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError>;

    /// Read a value from the struct body starting at word `at`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed or out-of-bounds input.
    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError>;
}

/// The user-facing codec entry points ([TDBIN-RS-API]): a typed value to
/// bytes and back, with no dynamic value model in between. Blanket-provided
/// for every [`Struct`].
pub trait TdBin: Struct {
    /// Encode to a fresh byte vector (v0: bare, unpacked framing).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the value exceeds a wire-format limit.
    fn to_bytes(&self) -> Result<Vec<u8>, EncodeError> {
        Writer::message(self)
    }

    /// Decode from bytes, safe on arbitrary untrusted input ([TDBIN-SAFE]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    fn from_bytes(wire: &[u8]) -> Result<Self, DecodeError> {
        Reader::message(wire)
    }

    /// Encode to a fresh framed byte vector ([TDBIN-MSG-FRAME]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the value or frame exceeds a wire-format limit.
    fn to_framed_bytes(&self, schema_hash: Option<u64>) -> Result<Vec<u8>, EncodeError> {
        let body = self.to_bytes()?;
        frame::encode(&body, frame::Options::new(false, schema_hash))
    }

    /// Encode to a fresh packed framed byte vector ([TDBIN-PACK]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the value, packing, or frame exceeds a limit.
    fn to_packed_framed_bytes(&self, schema_hash: Option<u64>) -> Result<Vec<u8>, EncodeError> {
        let body = self.to_bytes()?;
        frame::encode_packed(&body, schema_hash)
    }

    /// Decode from framed bytes, safe on arbitrary untrusted input.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed frames, packed bodies, or bad body bytes.
    fn from_framed_bytes(wire: &[u8]) -> Result<Self, DecodeError> {
        decode_framed::<Self>(wire, None)
    }

    /// Decode framed bytes while requiring an exact layout compatibility hash.
    ///
    /// # Errors
    /// Returns [`DecodeError::HashMismatch`] when the hash is absent or differs.
    fn from_framed_bytes_with_hash(wire: &[u8], expected: u64) -> Result<Self, DecodeError> {
        decode_framed::<Self>(wire, Some(expected))
    }
}

impl<T: Struct> TdBin for T {}

/// Decode a frame and optionally enforce its layout compatibility hash.
fn decode_framed<T: Struct>(wire: &[u8], expected: Option<u64>) -> Result<T, DecodeError> {
    let message = frame::decode(wire)?;
    if let Some(hash) = expected {
        (message.schema_hash() == Some(hash))
            .then_some(())
            .ok_or(DecodeError::HashMismatch {
                expected: hash,
                got: message.schema_hash(),
            })?;
    }
    if message.is_packed() {
        Reader::message(&pack::decode(message.body())?)
    } else {
        Reader::message(message.body())
    }
}
