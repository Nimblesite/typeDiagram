//! Cap'n Proto word packing for TDBIN bodies ([TDBIN-PACK]).
//!
//! Hot-path shape ([TDBIN-PACK-WORD], [TDBIN-PACK-RUNS]): whole words are
//! classified with a branch-free SWAR nonzero-byte mask, both directions
//! write through cursors into preallocated buffers (no per-byte growth
//! checks), zero runs cost two bytes to emit and a cursor bump to consume
//! (the output arrives pre-zeroed), and sparse words touch only their
//! nonzero bytes. Output is byte-identical to the reference algorithm: a
//! zero run starts on an all-zero word, a dense run starts on an all-nonzero
//! word and extends over words with at least seven nonzero bytes.

use crate::error::{DecodeError, EncodeError};

/// Bytes per TDBIN word.
const WORD_BYTES: usize = 8;
/// Maximum unpacked output accepted by the default decoder.
const MAX_UNPACKED_BYTES: usize = 1 << 29;
/// Tag for a zero-word run.
const ZERO_RUN_TAG: u8 = 0;
/// Tag for an uncompressible passthrough run.
const DENSE_RUN_TAG: u8 = 0xFF;
/// Maximum extra words encoded by a run count.
const MAX_RUN_COUNT: usize = 255;
/// Dense words are no larger as raw passthrough than sparse-packed bytes.
const DENSE_NONZERO_BYTES: u32 = 7;
/// Low seven bits of every byte lane (SWAR nonzero test).
const LANE_LOW: u64 = 0x7F7F_7F7F_7F7F_7F7F;
/// Bit 0 of every byte lane.
const LANE_ONES: u64 = 0x0101_0101_0101_0101;
/// Multiplier gathering per-lane high bits into the top byte (movemask).
const LANE_GATHER: u64 = 0x0102_0408_1020_4080;
/// Fast-decode window: one tag byte plus a full word plus slack.
const FAST_WINDOW: usize = 10;
/// Minimum decode-buffer growth step.
const GROW_STEP: usize = 1 << 16;
/// Headroom one fast element can need: a 256-word run.
const ELEMENT_ROOM: usize = 256 * WORD_BYTES;

/// Pack a word-aligned TDBIN body ([TDBIN-PACK-WORD], [TDBIN-PACK-RUNS]).
///
/// # Errors
/// Returns [`EncodeError`] when the body is not word-aligned or output capacity
/// overflows.
pub fn encode(body: &[u8]) -> Result<Vec<u8>, EncodeError> {
    let mut out = Vec::new();
    encode_into(body, &mut out)?;
    Ok(out)
}

/// Pack a word-aligned TDBIN body onto the end of `out` ([TDBIN-PACK]).
///
/// # Errors
/// Returns [`EncodeError`] when the body is not word-aligned or output capacity
/// overflows.
pub fn encode_into(body: &[u8], out: &mut Vec<u8>) -> Result<(), EncodeError> {
    body.len()
        .is_multiple_of(WORD_BYTES)
        .then_some(())
        .ok_or(EncodeError::BadLength)?;
    out.reserve(encode_capacity(body.len())?);
    let mut offset = 0;
    while let Some(word) = read_word(body, offset) {
        offset = encode_word(body, offset, word, out)?;
    }
    Ok(())
}

/// Unpack a packed TDBIN body.
///
/// # Errors
/// Returns [`DecodeError`] when the packed stream is truncated or would exceed
/// the decoder output cap.
pub fn decode(packed: &[u8]) -> Result<Vec<u8>, DecodeError> {
    let mut out = Vec::new();
    let mut written = 0_usize;
    let mut cursor = 0_usize;
    while window_at(packed, cursor).is_some() && grow_chunk(&mut out, written) {
        (cursor, written) = decode_chunk(packed, cursor, &mut out, written)?;
    }
    out.truncate(written);
    while let Some(tag) = packed.get(cursor).copied() {
        cursor = decode_tag(tag, packed, advance(cursor, 1)?, &mut out)?;
    }
    Ok(out)
}

/// Grow the pre-zeroed output so at least one worst-case element fits; `false`
/// near the output cap hands off to the exact careful tail.
fn grow_chunk(out: &mut Vec<u8>, written: usize) -> bool {
    match written.checked_add(ELEMENT_ROOM) {
        Some(needed) if needed <= MAX_UNPACKED_BYTES => {
            if out.len() < needed {
                let doubled = out.len().wrapping_mul(2).max(GROW_STEP);
                out.resize(doubled.min(MAX_UNPACKED_BYTES).max(needed), 0);
            }
            true
        }
        _ => false,
    }
}

/// Decode fast elements into the pre-zeroed slice until the headroom or the
/// input window runs out; the sparse path is fully inlined with no per-word
/// slice construction, so the loop is bounded by the tag-load/popcount chain.
fn decode_chunk(
    packed: &[u8],
    mut cursor: usize,
    out: &mut Vec<u8>,
    mut written: usize,
) -> Result<(usize, usize), DecodeError> {
    let limit = out.len().saturating_sub(ELEMENT_ROOM);
    let fast_end = packed.len().saturating_sub(FAST_WINDOW);
    let dst = out.as_mut_slice();
    while cursor <= fast_end && written <= limit {
        let tag = packed.get(cursor).copied().unwrap_or(0);
        if tag == ZERO_RUN_TAG || tag == DENSE_RUN_TAG {
            let Some(window) = window_at(packed, cursor) else {
                break;
            };
            (cursor, written) = decode_fast_element(packed, window, cursor, dst, written)?;
        } else {
            let end = cursor.wrapping_add(9);
            let src = packed
                .get(cursor.wrapping_add(1)..end)
                .and_then(|slice| <[u8; WORD_BYTES]>::try_from(slice).ok())
                .ok_or(DecodeError::PackedTruncated)?;
            let word = expand_word(tag, u64::from_le_bytes(src));
            if let Some(cell) = dst.get_mut(written..written.wrapping_add(WORD_BYTES)) {
                cell.copy_from_slice(&word.to_le_bytes());
            }
            let taken = usize::try_from(tag.count_ones()).unwrap_or(WORD_BYTES);
            cursor = cursor.wrapping_add(taken.wrapping_add(1));
            written = written.wrapping_add(WORD_BYTES);
        }
    }
    Ok((cursor, written))
}

/// Branchless sparse expansion: each lane independently locates its source
/// byte by prefix-popcount, so the eight lanes carry no data-dependent branch
/// and no serial register dependency (the previous shift-chain version
/// serialized every lane on the compacted source register).
fn expand_word(tag: u8, src: u64) -> u64 {
    let mut word = 0_u64;
    let mut lane = 0_u32;
    while lane < 8 {
        let present = u64::from(tag).wrapping_shr(lane) & 1;
        let below = u32::from(tag) & 1_u32.wrapping_shl(lane).wrapping_sub(1);
        let byte = src.wrapping_shr(below.count_ones().wrapping_mul(8)) & 0xFF;
        word |= byte
            .wrapping_mul(present)
            .wrapping_shl(lane.wrapping_mul(8));
        lane = lane.wrapping_add(1);
    }
    word
}

/// Worst-case packed capacity: an isolated all-dense word costs 10 bytes.
fn encode_capacity(body_len: usize) -> Result<usize, EncodeError> {
    body_len
        .checked_add(body_len >> 2)
        .and_then(|len| len.checked_add(FAST_WINDOW))
        .ok_or(EncodeError::LimitExceeded)
}

/// Encode one word, appending to `out` and returning the next input offset.
fn encode_word(
    body: &[u8],
    offset: usize,
    word: u64,
    out: &mut Vec<u8>,
) -> Result<usize, EncodeError> {
    match tag_of(word) {
        ZERO_RUN_TAG => encode_zero_run(body, offset, out),
        DENSE_RUN_TAG => encode_dense_run(body, offset, word, out),
        sparse => encode_sparse_word(offset, word, sparse, out),
    }
}

/// Encode a run of all-zero words.
fn encode_zero_run(body: &[u8], offset: usize, out: &mut Vec<u8>) -> Result<usize, EncodeError> {
    let first_extra = advance_encode(offset, WORD_BYTES)?;
    let extra = run_extras(body, first_extra, |word| word == 0)?;
    let count = u8::try_from(extra).map_err(|_| EncodeError::LimitExceeded)?;
    out.extend_from_slice(&[ZERO_RUN_TAG, count]);
    let extra_bytes = extra
        .checked_mul(WORD_BYTES)
        .ok_or(EncodeError::LimitExceeded)?;
    advance_encode(first_extra, extra_bytes)
}

/// Encode a dense passthrough run beginning with `word`.
fn encode_dense_run(
    body: &[u8],
    offset: usize,
    word: u64,
    out: &mut Vec<u8>,
) -> Result<usize, EncodeError> {
    let start = advance_encode(offset, WORD_BYTES)?;
    let extra = run_extras(body, start, |word| {
        tag_of(word).count_ones() >= DENSE_NONZERO_BYTES
    })?;
    let count = u8::try_from(extra).map_err(|_| EncodeError::LimitExceeded)?;
    let extra_bytes = extra
        .checked_mul(WORD_BYTES)
        .ok_or(EncodeError::LimitExceeded)?;
    let end = advance_encode(start, extra_bytes)?;
    let raw = body.get(start..end).ok_or(EncodeError::LimitExceeded)?;
    out.extend_from_slice(&[DENSE_RUN_TAG]);
    out.extend_from_slice(&word.to_le_bytes());
    out.extend_from_slice(&[count]);
    out.extend_from_slice(raw);
    Ok(end)
}

/// Encode a sparse word: the tag byte then only its nonzero bytes, gathered
/// into one register and appended with a single bounded copy (the previous
/// per-byte stores paid a bounds check per nonzero byte).
fn encode_sparse_word(
    offset: usize,
    word: u64,
    tag: u8,
    out: &mut Vec<u8>,
) -> Result<usize, EncodeError> {
    let mut buf = [0_u8; 9];
    let (head, tail) = buf.split_first_mut().ok_or(EncodeError::LimitExceeded)?;
    *head = tag;
    tail.copy_from_slice(&compact_word(word, tag).to_le_bytes());
    let len = usize::try_from(tag.count_ones())
        .map_err(|_| EncodeError::LimitExceeded)?
        .wrapping_add(1);
    let bytes = buf.get(..len).ok_or(EncodeError::LimitExceeded)?;
    out.extend_from_slice(bytes);
    advance_encode(offset, WORD_BYTES)
}

/// Gather the nonzero bytes of `word` (selected by `tag`) into the low lanes
/// of one register, in ascending lane order.
fn compact_word(word: u64, tag: u8) -> u64 {
    let mut packed = 0_u64;
    let mut shift = 0_u32;
    let mut bits = tag;
    while bits != 0 {
        let lane = bits.trailing_zeros();
        packed |= (word.wrapping_shr(lane.wrapping_mul(8)) & 0xFF).wrapping_shl(shift);
        shift = shift.wrapping_add(8);
        bits &= bits.wrapping_sub(1);
    }
    packed
}

/// Count extra words matching `predicate`, capped by the one-byte run count.
fn run_extras(
    body: &[u8],
    start: usize,
    predicate: impl Fn(u64) -> bool,
) -> Result<usize, EncodeError> {
    let mut count = 0;
    let mut offset = start;
    while count < MAX_RUN_COUNT {
        match read_word(body, offset) {
            Some(word) if predicate(word) => {
                count = count.checked_add(1).ok_or(EncodeError::LimitExceeded)?;
                offset = advance_encode(offset, WORD_BYTES)?;
            }
            _ => break,
        }
    }
    Ok(count)
}

/// Decode one element with unconditional whole-word reads: zero runs bump the
/// cursor over pre-zeroed output, dense runs bulk-copy, sparse words write
/// only their nonzero bytes. The caller guarantees `ELEMENT_ROOM` headroom.
fn decode_fast_element(
    packed: &[u8],
    window: &[u8],
    cursor: usize,
    dst: &mut [u8],
    written: usize,
) -> Result<(usize, usize), DecodeError> {
    let tag = window.first().copied().unwrap_or(0);
    match tag {
        ZERO_RUN_TAG => {
            let extra = usize::from(window.get(1).copied().unwrap_or(0));
            let bytes = extra
                .wrapping_add(1)
                .checked_mul(WORD_BYTES)
                .ok_or(DecodeError::LimitExceeded)?;
            Ok((advance(cursor, 2)?, advance(written, bytes)?))
        }
        DENSE_RUN_TAG => decode_fast_dense(packed, window, cursor, dst, written),
        sparse => {
            let src = window
                .get(1..1 + WORD_BYTES)
                .and_then(|slice| <[u8; WORD_BYTES]>::try_from(slice).ok())
                .ok_or(DecodeError::PackedTruncated)?;
            let word = expand_word(sparse, u64::from_le_bytes(src));
            copy_at(dst, written, &word.to_le_bytes())?;
            let taken =
                usize::try_from(sparse.count_ones()).map_err(|_| DecodeError::LimitExceeded)?;
            Ok((
                advance(cursor, taken.wrapping_add(1))?,
                advance(written, WORD_BYTES)?,
            ))
        }
    }
}

/// Decode a dense passthrough run in the fast path.
fn decode_fast_dense(
    packed: &[u8],
    window: &[u8],
    cursor: usize,
    dst: &mut [u8],
    written: usize,
) -> Result<(usize, usize), DecodeError> {
    let extra = usize::from(window.get(9).copied().unwrap_or(0));
    let raw_bytes = extra
        .checked_mul(WORD_BYTES)
        .ok_or(DecodeError::LimitExceeded)?;
    let word = window.get(1..9).ok_or(DecodeError::PackedTruncated)?;
    copy_at(dst, written, word)?;
    let raw_start = advance(cursor, FAST_WINDOW)?;
    let raw_end = advance(raw_start, raw_bytes)?;
    let raw = packed
        .get(raw_start..raw_end)
        .ok_or(DecodeError::PackedTruncated)?;
    copy_at(dst, written.wrapping_add(WORD_BYTES), raw)?;
    Ok((
        raw_end,
        advance(written, WORD_BYTES.wrapping_add(raw_bytes))?,
    ))
}

/// Copy `src` into the pre-zeroed output at `at`.
fn copy_at(out: &mut [u8], at: usize, src: &[u8]) -> Result<(), DecodeError> {
    let end = at
        .checked_add(src.len())
        .ok_or(DecodeError::LimitExceeded)?;
    out.get_mut(at..end)
        .ok_or(DecodeError::LimitExceeded)?
        .copy_from_slice(src);
    Ok(())
}

/// The remaining bytes at `cursor` when at least a full window remains.
fn window_at(packed: &[u8], cursor: usize) -> Option<&[u8]> {
    packed
        .get(cursor..)
        .filter(|window| window.len() >= FAST_WINDOW)
}

/// Decode one tag near the end of the stream and return the next cursor.
fn decode_tag(
    tag: u8,
    packed: &[u8],
    cursor: usize,
    out: &mut Vec<u8>,
) -> Result<usize, DecodeError> {
    match tag {
        ZERO_RUN_TAG => decode_zero_run(packed, cursor, out),
        DENSE_RUN_TAG => decode_dense_run(packed, cursor, out),
        sparse => decode_sparse_word(sparse, packed, cursor, out),
    }
}

/// Decode a zero-word run.
fn decode_zero_run(packed: &[u8], cursor: usize, out: &mut Vec<u8>) -> Result<usize, DecodeError> {
    let extra = usize::from(read_u8(packed, cursor)?);
    let words = extra.checked_add(1).ok_or(DecodeError::LimitExceeded)?;
    let bytes = words
        .checked_mul(WORD_BYTES)
        .ok_or(DecodeError::LimitExceeded)?;
    let len = checked_output_len(out.len(), bytes)?;
    out.resize(len, 0);
    advance(cursor, 1)
}

/// Decode a dense passthrough run with one bulk copy per section.
fn decode_dense_run(packed: &[u8], cursor: usize, out: &mut Vec<u8>) -> Result<usize, DecodeError> {
    let word_end = advance(cursor, WORD_BYTES)?;
    append_bytes(out, read_range(packed, cursor, word_end)?)?;
    let extra = usize::from(read_u8(packed, word_end)?);
    let raw_start = advance(word_end, 1)?;
    let raw_bytes = extra
        .checked_mul(WORD_BYTES)
        .ok_or(DecodeError::LimitExceeded)?;
    let raw_end = advance(raw_start, raw_bytes)?;
    append_bytes(out, read_range(packed, raw_start, raw_end)?)?;
    Ok(raw_end)
}

/// Decode a sparse word near the end of the stream, byte by byte.
fn decode_sparse_word(
    tag: u8,
    packed: &[u8],
    cursor: usize,
    out: &mut Vec<u8>,
) -> Result<usize, DecodeError> {
    let nonzero = usize::try_from(tag.count_ones()).map_err(|_| DecodeError::LimitExceeded)?;
    let end = advance(cursor, nonzero)?;
    let src = read_range(packed, cursor, end)?;
    let mut word = 0_u64;
    let mut bytes = src.iter();
    let mut bits = tag;
    while bits != 0 {
        let lane = bits.trailing_zeros();
        let byte = bytes.next().copied().ok_or(DecodeError::PackedTruncated)?;
        word |= u64::from(byte).wrapping_shl(lane.wrapping_mul(8));
        bits &= bits.wrapping_sub(1);
    }
    append_bytes(out, &word.to_le_bytes())?;
    Ok(end)
}

/// Branch-free nonzero-byte mask of a word ([TDBIN-PACK-WORD]): SWAR nonzero
/// test per lane, then a movemask multiply gathering lane bits LSB-first.
fn tag_of(word: u64) -> u8 {
    let nonzero = (word & LANE_LOW).wrapping_add(LANE_LOW) | word;
    let lanes = (nonzero >> 7) & LANE_ONES;
    u8::try_from(lanes.wrapping_mul(LANE_GATHER).wrapping_shr(56)).unwrap_or(0)
}

/// Append bytes while enforcing the unpacked output cap.
fn append_bytes(out: &mut Vec<u8>, bytes: &[u8]) -> Result<(), DecodeError> {
    checked_output_len(out.len(), bytes.len()).map(|_| ())?;
    out.extend_from_slice(bytes);
    Ok(())
}

/// Checked output length after appending `bytes`.
fn checked_output_len(current: usize, bytes: usize) -> Result<usize, DecodeError> {
    let len = current
        .checked_add(bytes)
        .ok_or(DecodeError::LimitExceeded)?;
    (len <= MAX_UNPACKED_BYTES)
        .then_some(len)
        .ok_or(DecodeError::LimitExceeded)
}

/// Read one byte at `offset`.
fn read_u8(bytes: &[u8], offset: usize) -> Result<u8, DecodeError> {
    bytes
        .get(offset)
        .copied()
        .ok_or(DecodeError::PackedTruncated)
}

/// Read the whole little-endian word at byte `offset`, or `None` past the end.
fn read_word(bytes: &[u8], offset: usize) -> Option<u64> {
    let end = offset.checked_add(WORD_BYTES)?;
    bytes
        .get(offset..end)
        .and_then(|slice| <[u8; WORD_BYTES]>::try_from(slice).ok())
        .map(u64::from_le_bytes)
}

/// Read the range `start..end`.
fn read_range(bytes: &[u8], start: usize, end: usize) -> Result<&[u8], DecodeError> {
    bytes.get(start..end).ok_or(DecodeError::PackedTruncated)
}

/// Checked offset advance.
fn advance(offset: usize, count: usize) -> Result<usize, DecodeError> {
    offset.checked_add(count).ok_or(DecodeError::LimitExceeded)
}

/// Checked offset advance for encode paths.
fn advance_encode(offset: usize, count: usize) -> Result<usize, EncodeError> {
    offset.checked_add(count).ok_or(EncodeError::LimitExceeded)
}
