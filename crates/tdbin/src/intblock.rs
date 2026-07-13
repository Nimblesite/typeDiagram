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
    let (floor, width) = delta_stats(values);
    let mut out = Vec::with_capacity(block_len(values.len(), width)?);
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&first.to_le_bytes());
    out.extend_from_slice(&floor.to_le_bytes());
    out.push(u8::try_from(width).map_err(|_| EncodeError::LimitExceeded)?);
    pack_deltas(values, floor, width, &mut out);
    Ok(out)
}

/// The minimum zigzag delta and the minimal bit width covering the range,
/// computed in two streaming passes with no intermediate buffer.
fn delta_stats(values: &[i64]) -> (u64, u32) {
    let floor = deltas(values).min().unwrap_or_default();
    let width = deltas(values)
        .map(|delta| WORD_BITS.wrapping_sub(delta.wrapping_sub(floor).leading_zeros()))
        .max()
        .unwrap_or_default();
    (floor, width)
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
fn deltas(values: &[i64]) -> impl Iterator<Item = u64> + '_ {
    values.windows(2).map(|pair| {
        let previous = pair.first().copied().unwrap_or_default();
        let next = pair.get(1).copied().unwrap_or_default();
        zigzag(next.wrapping_sub(previous))
    })
}

/// Append `width`-bit deltas (relative to `floor`) as a little-endian stream,
/// flushing whole 64-bit words instead of single bytes.
fn pack_deltas(values: &[i64], floor: u64, width: u32, out: &mut Vec<u8>) {
    let mut acc = 0_u64;
    let mut filled = 0_u32;
    for delta in deltas(values) {
        let value = delta.wrapping_sub(floor) & mask_of(width);
        acc |= value.wrapping_shl(filled);
        match filled.checked_add(width) {
            Some(next) if next < WORD_BITS => filled = next,
            _ => {
                out.extend_from_slice(&acc.to_le_bytes());
                acc = shr_full(value, WORD_BITS.wrapping_sub(filled));
                filled = filled.wrapping_add(width).wrapping_sub(WORD_BITS);
            }
        }
    }
    flush_partial(acc, filled, out);
}

/// Flush the trailing partial word: only the bytes carrying `filled` bits.
fn flush_partial(acc: u64, filled: u32, out: &mut Vec<u8>) {
    let bytes = usize::try_from(filled.div_ceil(8)).unwrap_or(8);
    out.extend_from_slice(acc.to_le_bytes().get(..bytes).unwrap_or_default());
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

    /// Read the next `width` bits (little-endian), zero-padded past the end:
    /// one unaligned word load covers every width up to 57 bits, and a second
    /// load stitches the rare wide read that crosses the first word's end.
    fn read(&mut self, width: u32) -> u64 {
        let index = self.bit / 8;
        let shift = u32::try_from(self.bit % 8).unwrap_or(0);
        let have = WORD_BITS.wrapping_sub(shift);
        let lo = load_padded(self.bytes, index).wrapping_shr(shift);
        let value = if width <= have {
            lo & mask_of(width)
        } else {
            let hi = load_padded(self.bytes, index.wrapping_add(8));
            (lo | hi.wrapping_shl(have)) & mask_of(width)
        };
        self.bit = self.bit.wrapping_add(usize::try_from(width).unwrap_or(0));
        value
    }
}

/// Load the little-endian word at byte `index`, zero-padded past the end.
fn load_padded(bytes: &[u8], index: usize) -> u64 {
    bytes
        .get(index..index.wrapping_add(8))
        .and_then(|slice| <[u8; 8]>::try_from(slice).ok())
        .map_or_else(|| tail_word(bytes, index), u64::from_le_bytes)
}

/// Little-endian fold of the partial tail starting at `index`.
fn tail_word(bytes: &[u8], index: usize) -> u64 {
    bytes
        .get(index..)
        .unwrap_or_default()
        .iter()
        .rev()
        .fold(0_u64, |acc, byte| acc.wrapping_shl(8) | u64::from(*byte))
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
