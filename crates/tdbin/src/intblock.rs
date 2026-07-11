//! Frame-of-reference delta bit-packing for integer columns
//! ([TDBIN-COL-INTBLOCK], research §3.2 `[S13]`): the scalar reference codec
//! for the SIMD-BP128 family. A column stores its first value, the minimum
//! zigzagged delta, one bit width, then every remaining delta packed at that
//! width — monotonic ID columns collapse to a header, and arbitrary values
//! degrade to at most raw width. Output is canonical: the width is the
//! minimal one for the data, so identical values give identical bytes.

use crate::error::{DecodeError, EncodeError};

/// Header bytes: count (4) + first value (8) + minimum zigzag delta (8) +
/// bit width (1).
const HEADER_BYTES: usize = 21;
/// Bits per packed word.
const WORD_BITS: u32 = 64;

/// Zigzag-encode a signed delta so small magnitudes pack small.
fn zigzag(value: i64) -> u64 {
    let shifted = u64::from_le_bytes(value.to_le_bytes()).wrapping_shl(1);
    let sign = u64::from_le_bytes(value.wrapping_shr(63).to_le_bytes());
    shifted ^ sign
}

/// Invert [`zigzag`].
fn unzigzag(value: u64) -> i64 {
    let magnitude = i64::from_le_bytes((value >> 1).to_le_bytes());
    let sign = i64::from_le_bytes((value & 1).wrapping_neg().to_le_bytes());
    magnitude ^ sign
}

/// Encode a nonempty integer column into a canonical delta block.
///
/// # Errors
/// Returns [`EncodeError::LimitExceeded`] on arithmetic overflow (unreachable
/// for in-memory slices).
pub(crate) fn encode(values: &[i64]) -> Result<Vec<u8>, EncodeError> {
    let count = u32::try_from(values.len()).map_err(|_| EncodeError::LimitExceeded)?;
    let first = values.first().copied().unwrap_or_default();
    let deltas = zigzag_deltas(values);
    let floor = deltas.iter().copied().min().unwrap_or_default();
    let width = deltas
        .iter()
        .map(|delta| WORD_BITS.wrapping_sub(delta.wrapping_sub(floor).leading_zeros()))
        .max()
        .unwrap_or_default();
    let mut out = Vec::with_capacity(block_len(values.len(), width)?);
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&first.to_le_bytes());
    out.extend_from_slice(&floor.to_le_bytes());
    out.push(u8::try_from(width).map_err(|_| EncodeError::LimitExceeded)?);
    pack_bits(&deltas, floor, width, &mut out);
    Ok(out)
}

/// Read a block's declared logical count without decoding it.
///
/// # Errors
/// Returns [`DecodeError::MalformedColumn`] on a truncated header.
pub(crate) fn peek_count(block: &[u8]) -> Result<usize, DecodeError> {
    block
        .get(..4)
        .and_then(|slice| <[u8; 4]>::try_from(slice).ok())
        .map(u32::from_le_bytes)
        .and_then(|count| usize::try_from(count).ok())
        .ok_or(DecodeError::MalformedColumn)
}

/// Total encoded bytes for `count` values at `width` bits per delta.
pub(crate) fn block_len(count: usize, width: u32) -> Result<usize, EncodeError> {
    let deltas = count.saturating_sub(1);
    let bits = deltas
        .checked_mul(usize::try_from(width).map_err(|_| EncodeError::LimitExceeded)?)
        .ok_or(EncodeError::LimitExceeded)?;
    bits.div_ceil(8)
        .checked_add(HEADER_BYTES)
        .ok_or(EncodeError::LimitExceeded)
}

/// Decode a delta block back into exactly `count` values.
///
/// # Errors
/// Returns [`DecodeError::MalformedColumn`] when the block length disagrees
/// with `count` and its declared width.
pub(crate) fn decode(block: &[u8]) -> Result<Vec<i64>, DecodeError> {
    let count = peek_count(block)?;
    let first = read_u64(block, 4)?;
    let floor = read_u64(block, 12)?;
    let width = u32::from(block.get(20).copied().ok_or(DecodeError::MalformedColumn)?);
    let expected = block_len(count, width).map_err(|_| DecodeError::LimitExceeded)?;
    if width > 64 || block.len() != expected || count == 0 {
        return Err(DecodeError::MalformedColumn);
    }
    let mut out = Vec::with_capacity(count);
    let mut acc = i64::from_le_bytes(first.to_le_bytes());
    out.push(acc);
    let mut bits = BitReader::new(block.get(HEADER_BYTES..).unwrap_or_default());
    for _ in 1..count {
        let delta = unzigzag(bits.read(width).wrapping_add(floor));
        acc = acc.wrapping_add(delta);
        out.push(acc);
    }
    Ok(out)
}

/// Zigzagged wrapping deltas between consecutive values.
fn zigzag_deltas(values: &[i64]) -> Vec<u64> {
    values
        .windows(2)
        .map(|pair| {
            let previous = pair.first().copied().unwrap_or_default();
            let next = pair.get(1).copied().unwrap_or_default();
            zigzag(next.wrapping_sub(previous))
        })
        .collect()
}

/// Append `width`-bit values (relative to `floor`) as a little-endian stream.
fn pack_bits(deltas: &[u64], floor: u64, width: u32, out: &mut Vec<u8>) {
    let mut acc = 0_u64;
    let mut filled = 0_u32;
    for delta in deltas {
        let mut value = delta.wrapping_sub(floor);
        let mut remaining = width;
        while remaining > 0 {
            let take = remaining.min(WORD_BITS.wrapping_sub(filled));
            acc |= (value & mask_of(take)).wrapping_shl(filled);
            filled = filled.wrapping_add(take);
            value = shr_full(value, take);
            remaining = remaining.wrapping_sub(take);
            while filled >= 8 {
                out.push(u8::try_from(acc & 0xFF).unwrap_or(0));
                acc = acc.wrapping_shr(8);
                filled = filled.wrapping_sub(8);
            }
        }
    }
    if filled > 0 {
        out.push(u8::try_from(acc & 0xFF).unwrap_or(0));
    }
}

/// Shift right by up to 64 bits (a 64-bit shift yields zero).
fn shr_full(value: u64, amount: u32) -> u64 {
    match amount {
        64 => 0,
        _ => value.wrapping_shr(amount),
    }
}

/// A little-endian bit-stream reader over the packed delta area.
struct BitReader<'a> {
    /// The packed bytes.
    bytes: &'a [u8],
    /// Absolute bit cursor.
    bit: usize,
}

impl<'a> BitReader<'a> {
    /// Start reading at bit zero.
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, bit: 0 }
    }

    /// Read the next `width` bits (little-endian), zero-padded past the end.
    fn read(&mut self, width: u32) -> u64 {
        let mut value = 0_u64;
        let mut got = 0_u32;
        while got < width {
            let byte_index = self.bit / 8;
            let bit_offset = u32::try_from(self.bit % 8).unwrap_or(0);
            let available = 8_u32.wrapping_sub(bit_offset);
            let take = available.min(width.wrapping_sub(got));
            let byte = u64::from(self.bytes.get(byte_index).copied().unwrap_or(0));
            let mask = mask_of(take);
            value |= (byte.wrapping_shr(bit_offset) & mask).wrapping_shl(got);
            got = got.wrapping_add(take);
            self.bit = self.bit.wrapping_add(usize::try_from(take).unwrap_or(0));
        }
        value
    }
}

/// Read a little-endian u64 at `offset`.
fn read_u64(block: &[u8], offset: usize) -> Result<u64, DecodeError> {
    block
        .get(offset..offset.wrapping_add(8))
        .and_then(|slice| <[u8; 8]>::try_from(slice).ok())
        .map(u64::from_le_bytes)
        .ok_or(DecodeError::MalformedColumn)
}

/// A `width`-bit all-ones mask (width ≤ 64).
fn mask_of(width: u32) -> u64 {
    match width {
        64 => u64::MAX,
        _ => 1_u64.wrapping_shl(width).wrapping_sub(1),
    }
}
