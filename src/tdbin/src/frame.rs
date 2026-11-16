//! Transport framing for TDBIN messages ([TDBIN-MSG-FRAME]): length-prefixed
//! self-delimiting frames concatenate into streams, with the layout hash
//! negotiated once per stream ([TDBIN-MSG-STREAM]).
//!
//! The frame layer is deliberately separate from the bare message reader and
//! writer: it validates the self-describing envelope, then exposes the body
//! bytes exactly as they appeared on the wire.

use crate::error::{DecodeError, EncodeError};
use crate::pack;

/// Header magic bytes: ASCII `TDB1`.
const MAGIC: [u8; 4] = [0x54, 0x44, 0x42, 0x31];
/// Supported frame version.
const VERSION: u8 = 1;
/// Offset of the version byte.
const VERSION_OFFSET: usize = 4;
/// Offset of the flags byte.
const FLAGS_OFFSET: usize = 5;
/// Offset of the reserved u16 field.
const RESERVED_OFFSET: usize = 6;
/// Offset of the body length u32 field.
const BODY_LEN_OFFSET: usize = 8;
/// Length of a frame header without a schema hash.
const BASE_HEADER_LEN: usize = 12;
/// Length of a frame header with a schema hash.
const HASH_HEADER_LEN: usize = 20;
/// The `PACKED` flag bit.
const FLAG_PACKED: u8 = 0b0000_0001;
/// The schema `HASH` flag bit.
const FLAG_HASH: u8 = 0b0000_0010;
/// All flag bits known to this implementation.
const KNOWN_FLAGS: u8 = FLAG_PACKED | FLAG_HASH;

/// Options used when encoding a TDBIN frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    /// Whether the body has already been Cap'n-Proto packed.
    packed: bool,
    /// Optional schema hash to include in the frame header.
    schema_hash: Option<u64>,
}

impl Options {
    /// Create frame options from already-packed state and an optional hash.
    #[must_use]
    pub const fn new(packed: bool, schema_hash: Option<u64>) -> Self {
        Self {
            packed,
            schema_hash,
        }
    }

    /// Create options for the common unpacked, hash-free frame.
    #[must_use]
    pub const fn bare() -> Self {
        Self::new(false, None)
    }

    /// Encode the flag byte for these options.
    const fn flags(self) -> u8 {
        let packed = if self.packed { FLAG_PACKED } else { 0 };
        let hash = match self.schema_hash {
            Some(_) => FLAG_HASH,
            None => 0,
        };
        packed | hash
    }
}

/// A decoded TDBIN frame borrowing its body from the source buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Message<'a> {
    /// Body bytes exactly as carried by the frame.
    body: &'a [u8],
    /// Whether `body` is packed on the wire.
    packed: bool,
    /// Optional schema hash from the frame header.
    schema_hash: Option<u64>,
}

impl<'a> Message<'a> {
    /// Return the framed body exactly as it appeared on the wire.
    #[must_use]
    pub const fn body(self) -> &'a [u8] {
        self.body
    }

    /// Return whether the body is packed ([TDBIN-PACK]).
    #[must_use]
    pub const fn is_packed(self) -> bool {
        self.packed
    }

    /// Return the optional schema hash ([TDBIN-SCHEMA-HASH]).
    #[must_use]
    pub const fn schema_hash(self) -> Option<u64> {
        self.schema_hash
    }
}

/// Encode a TDBIN frame around `body` ([TDBIN-MSG-FRAME]).
///
/// # Errors
/// Returns [`EncodeError::LimitExceeded`] when the body length exceeds `u32`.
pub fn encode(body: &[u8], options: Options) -> Result<Vec<u8>, EncodeError> {
    let header_len = header_len(options.flags());
    let capacity = header_len
        .checked_add(body.len())
        .ok_or(EncodeError::LimitExceeded)?;
    let mut out = Vec::with_capacity(capacity);
    out.resize(header_len, 0);
    out.extend_from_slice(body);
    fill_header(&mut out, options)?;
    Ok(out)
}

/// Pack `body`, then encode a packed TDBIN frame ([TDBIN-PACK]).
///
/// # Errors
/// Returns [`EncodeError`] when packing or framing exceeds a limit.
pub fn encode_packed(body: &[u8], schema_hash: Option<u64>) -> Result<Vec<u8>, EncodeError> {
    let options = Options::new(true, schema_hash);
    let mut out = vec![0; header_len(options.flags())];
    pack::encode_into(body, &mut out)?;
    fill_header(&mut out, options)?;
    Ok(out)
}

/// Reserved header bytes for a frame with or without a schema hash.
pub(crate) const fn header_len_for(schema_hash: Option<u64>) -> usize {
    match schema_hash {
        Some(_) => HASH_HEADER_LEN,
        None => BASE_HEADER_LEN,
    }
}

/// Fill the reserved frame header at the front of an encoded message whose
/// body already follows it ([TDBIN-MSG-FRAME]).
///
/// # Errors
/// Returns [`EncodeError::LimitExceeded`] when the body length exceeds `u32`.
pub(crate) fn fill_header(out: &mut [u8], options: Options) -> Result<(), EncodeError> {
    let header_len = header_len(options.flags());
    let body_len = out
        .len()
        .checked_sub(header_len)
        .and_then(|len| u32::try_from(len).ok())
        .ok_or(EncodeError::LimitExceeded)?;
    let header = out
        .get_mut(..header_len)
        .ok_or(EncodeError::LimitExceeded)?;
    write_at(header, 0, &MAGIC)?;
    write_at(header, VERSION_OFFSET, &[VERSION])?;
    write_at(header, FLAGS_OFFSET, &[options.flags()])?;
    write_at(header, RESERVED_OFFSET, &0_u16.to_le_bytes())?;
    write_at(header, BODY_LEN_OFFSET, &body_len.to_le_bytes())?;
    match options.schema_hash {
        None => Ok(()),
        Some(hash) => write_at(header, BASE_HEADER_LEN, &hash.to_le_bytes()),
    }
}

/// Copy `src` into `dst` at `offset`, bounds-checked.
fn write_at(dst: &mut [u8], offset: usize, src: &[u8]) -> Result<(), EncodeError> {
    let end = offset
        .checked_add(src.len())
        .ok_or(EncodeError::LimitExceeded)?;
    dst.get_mut(offset..end)
        .ok_or(EncodeError::LimitExceeded)?
        .copy_from_slice(src);
    Ok(())
}

/// Decode a TDBIN frame, validating every reserved field and length.
///
/// # Errors
/// Returns [`DecodeError`] when the frame header or body length is malformed.
pub fn decode(bytes: &[u8]) -> Result<Message<'_>, DecodeError> {
    require_len(bytes, BASE_HEADER_LEN)?;
    require_magic(bytes)?;
    require_version(bytes)?;
    let flags = read_u8(bytes, FLAGS_OFFSET)?;
    require_known_flags(flags)?;
    require_reserved(bytes)?;
    let body_len = read_u32(bytes, BODY_LEN_OFFSET)?;
    let schema_hash = read_schema_hash(bytes, flags)?;
    let body = read_body(bytes, header_len(flags), body_len)?;
    Ok(Message {
        body,
        packed: has_flag(flags, FLAG_PACKED),
        schema_hash,
    })
}

/// Return the header length implied by `flags`.
const fn header_len(flags: u8) -> usize {
    if has_flag(flags, FLAG_HASH) {
        HASH_HEADER_LEN
    } else {
        BASE_HEADER_LEN
    }
}

/// Return whether `flag` is set in `flags`.
const fn has_flag(flags: u8, flag: u8) -> bool {
    flags & flag == flag
}

/// Require at least `needed` bytes.
fn require_len(bytes: &[u8], needed: usize) -> Result<(), DecodeError> {
    bytes
        .get(..needed)
        .map(|_| ())
        .ok_or(DecodeError::LengthMismatch)
}

/// Require the frame magic bytes.
fn require_magic(bytes: &[u8]) -> Result<(), DecodeError> {
    let got = bytes
        .get(..MAGIC.len())
        .ok_or(DecodeError::LengthMismatch)?;
    (got == MAGIC.as_slice())
        .then_some(())
        .ok_or(DecodeError::BadMagic)
}

/// Require the supported frame version.
fn require_version(bytes: &[u8]) -> Result<(), DecodeError> {
    match read_u8(bytes, VERSION_OFFSET)? {
        VERSION => Ok(()),
        version => Err(DecodeError::BadVersion { version }),
    }
}

/// Require that no unknown flag bits are set.
fn require_known_flags(flags: u8) -> Result<(), DecodeError> {
    (flags & !KNOWN_FLAGS == 0)
        .then_some(())
        .ok_or(DecodeError::ReservedBits)
}

/// Require the reserved u16 header field to be zero.
fn require_reserved(bytes: &[u8]) -> Result<(), DecodeError> {
    (read_u16(bytes, RESERVED_OFFSET)? == 0)
        .then_some(())
        .ok_or(DecodeError::ReservedBits)
}

/// Read the optional schema hash.
fn read_schema_hash(bytes: &[u8], flags: u8) -> Result<Option<u64>, DecodeError> {
    if has_flag(flags, FLAG_HASH) {
        read_u64(bytes, BASE_HEADER_LEN).map(Some)
    } else {
        Ok(None)
    }
}

/// Read and validate the frame body.
fn read_body(bytes: &[u8], start: usize, body_len: u32) -> Result<&[u8], DecodeError> {
    let len = usize::try_from(body_len).map_err(|_| DecodeError::LengthMismatch)?;
    let end = start.checked_add(len).ok_or(DecodeError::LengthMismatch)?;
    let body = bytes.get(start..end).ok_or(DecodeError::LengthMismatch)?;
    (bytes.len() == end)
        .then_some(body)
        .ok_or(DecodeError::LengthMismatch)
}

/// Read one byte at `offset`.
fn read_u8(bytes: &[u8], offset: usize) -> Result<u8, DecodeError> {
    bytes
        .get(offset)
        .copied()
        .ok_or(DecodeError::LengthMismatch)
}

/// Read a little-endian u16 at `offset`.
fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, DecodeError> {
    read_fixed::<2>(bytes, offset).map(u16::from_le_bytes)
}

/// Read a little-endian u32 at `offset`.
fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, DecodeError> {
    read_fixed::<4>(bytes, offset).map(u32::from_le_bytes)
}

/// Read a little-endian u64 at `offset`.
fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, DecodeError> {
    read_fixed::<8>(bytes, offset).map(u64::from_le_bytes)
}

/// Read a fixed-size byte array at `offset`.
fn read_fixed<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], DecodeError> {
    let end = offset.checked_add(N).ok_or(DecodeError::LengthMismatch)?;
    let slice = bytes.get(offset..end).ok_or(DecodeError::LengthMismatch)?;
    <[u8; N]>::try_from(slice).map_err(|_| DecodeError::LengthMismatch)
}
