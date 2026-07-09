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
mod layout;
mod pointer;
mod reader;
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
}

impl<T: Struct> TdBin for T {}
