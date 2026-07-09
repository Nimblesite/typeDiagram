//! Cap'n Proto word packing for TDBIN bodies ([TDBIN-PACK]).

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
const DENSE_NONZERO_BYTES: u8 = 7;

/// Pack a word-aligned TDBIN body ([TDBIN-PACK-WORD], [TDBIN-PACK-RUNS]).
///
/// # Errors
/// Returns [`EncodeError`] when the body is not word-aligned or output capacity
/// overflows.
pub fn encode(body: &[u8]) -> Result<Vec<u8>, EncodeError> {
    body.len()
        .is_multiple_of(WORD_BYTES)
        .then_some(())
        .ok_or(EncodeError::BadLength)?;
    let mut out = Vec::with_capacity(body.len());
    let mut offset = 0;
    while offset < body.len() {
        let word = read_word(body, offset).map_err(|_| EncodeError::LimitExceeded)?;
        offset = encode_word(body, offset, word, &mut out)?;
    }
    Ok(out)
}

/// Unpack a packed TDBIN body.
///
/// # Errors
/// Returns [`DecodeError`] when the packed stream is truncated or would exceed
/// the decoder output cap.
pub fn decode(packed: &[u8]) -> Result<Vec<u8>, DecodeError> {
    let mut out = Vec::with_capacity(initial_decode_capacity(packed.len())?);
    let mut cursor = 0;
    while cursor < packed.len() {
        let tag = read_u8(packed, cursor)?;
        cursor = advance(cursor, 1)?;
        cursor = decode_tag(tag, packed, cursor, &mut out)?;
    }
    Ok(out)
}

/// Encode one word and return the next input offset.
fn encode_word(
    body: &[u8],
    offset: usize,
    word: [u8; WORD_BYTES],
    out: &mut Vec<u8>,
) -> Result<usize, EncodeError> {
    let tag = tag_word(word)?;
    match tag {
        ZERO_RUN_TAG => encode_zero_run(body, offset, out),
        DENSE_RUN_TAG => encode_dense_run(body, offset, word, out),
        sparse => encode_sparse_word(offset, word, sparse, out),
    }
}

/// Encode a run of all-zero words.
fn encode_zero_run(body: &[u8], offset: usize, out: &mut Vec<u8>) -> Result<usize, EncodeError> {
    let extra = count_zero_extras(body, advance_encode(offset, WORD_BYTES)?)?;
    out.push(ZERO_RUN_TAG);
    out.push(u8::try_from(extra).map_err(|_| EncodeError::LimitExceeded)?);
    let words = extra.checked_add(1).ok_or(EncodeError::LimitExceeded)?;
    let bytes = words
        .checked_mul(WORD_BYTES)
        .ok_or(EncodeError::LimitExceeded)?;
    advance_encode(offset, bytes)
}

/// Encode a dense passthrough run beginning with `word`.
fn encode_dense_run(
    body: &[u8],
    offset: usize,
    word: [u8; WORD_BYTES],
    out: &mut Vec<u8>,
) -> Result<usize, EncodeError> {
    let extra = count_dense_extras(body, advance_encode(offset, WORD_BYTES)?)?;
    out.push(DENSE_RUN_TAG);
    out.extend_from_slice(&word);
    out.push(u8::try_from(extra).map_err(|_| EncodeError::LimitExceeded)?);
    let start = advance_encode(offset, WORD_BYTES)?;
    let extra_bytes = extra
        .checked_mul(WORD_BYTES)
        .ok_or(EncodeError::LimitExceeded)?;
    let end = advance_encode(start, extra_bytes)?;
    let raw = body.get(start..end).ok_or(EncodeError::LimitExceeded)?;
    out.extend_from_slice(raw);
    Ok(end)
}

/// Encode a sparse word.
fn encode_sparse_word(
    offset: usize,
    word: [u8; WORD_BYTES],
    tag: u8,
    out: &mut Vec<u8>,
) -> Result<usize, EncodeError> {
    out.push(tag);
    append_nonzero_bytes(word, out);
    advance_encode(offset, WORD_BYTES)
}

/// Decode one tag and return the next packed cursor.
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
    append_zero_words(out, words)?;
    advance(cursor, 1)
}

/// Decode a dense passthrough run.
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

/// Decode a sparse word.
fn decode_sparse_word(
    tag: u8,
    packed: &[u8],
    cursor: usize,
    out: &mut Vec<u8>,
) -> Result<usize, DecodeError> {
    let mut word = [0_u8; WORD_BYTES];
    let mut next = cursor;
    for offset in 0..WORD_BYTES {
        next = read_tagged_byte(tag, packed, next, offset, &mut word)?;
    }
    append_bytes(out, &word)?;
    Ok(next)
}

/// Read a tagged sparse byte when present.
fn read_tagged_byte(
    tag: u8,
    packed: &[u8],
    cursor: usize,
    offset: usize,
    word: &mut [u8; WORD_BYTES],
) -> Result<usize, DecodeError> {
    if tag & bit(offset)? == 0 {
        Ok(cursor)
    } else {
        let byte = read_u8(packed, cursor)?;
        let slot = word.get_mut(offset).ok_or(DecodeError::LimitExceeded)?;
        *slot = byte;
        advance(cursor, 1)
    }
}

/// Count extra all-zero words after `offset`.
fn count_zero_extras(body: &[u8], offset: usize) -> Result<usize, EncodeError> {
    count_matching_extras(body, offset, is_zero_word)
}

/// Count extra dense words after `offset`.
fn count_dense_extras(body: &[u8], offset: usize) -> Result<usize, EncodeError> {
    count_matching_extras(body, offset, is_dense_word)
}

/// Count extra words matching `predicate`, capped by the one-byte run count.
fn count_matching_extras(
    body: &[u8],
    mut offset: usize,
    predicate: fn([u8; WORD_BYTES]) -> Result<bool, EncodeError>,
) -> Result<usize, EncodeError> {
    let mut count = 0;
    while count < MAX_RUN_COUNT && offset < body.len() {
        let word = read_word(body, offset).map_err(|_| EncodeError::LimitExceeded)?;
        if !predicate(word)? {
            break;
        }
        count = count.checked_add(1).ok_or(EncodeError::LimitExceeded)?;
        offset = advance_encode(offset, WORD_BYTES)?;
    }
    Ok(count)
}

/// Return whether a word is all zero bytes.
fn is_zero_word(word: [u8; WORD_BYTES]) -> Result<bool, EncodeError> {
    tag_word(word).map(|tag| tag == ZERO_RUN_TAG)
}

/// Return whether a word is dense enough for passthrough.
fn is_dense_word(word: [u8; WORD_BYTES]) -> Result<bool, EncodeError> {
    nonzero_count(word).map(|count| count >= DENSE_NONZERO_BYTES)
}

/// Compute the sparse tag for a word.
fn tag_word(word: [u8; WORD_BYTES]) -> Result<u8, EncodeError> {
    let mut tag = 0_u8;
    for (offset, byte) in word.iter().enumerate() {
        if *byte != 0 {
            tag |= bit(offset).map_err(|_| EncodeError::LimitExceeded)?;
        }
    }
    Ok(tag)
}

/// Count non-zero bytes in a word.
fn nonzero_count(word: [u8; WORD_BYTES]) -> Result<u8, EncodeError> {
    let mut count = 0_u8;
    for byte in word {
        if byte != 0 {
            count = count.checked_add(1).ok_or(EncodeError::LimitExceeded)?;
        }
    }
    Ok(count)
}

/// Append non-zero bytes in word order.
fn append_nonzero_bytes(word: [u8; WORD_BYTES], out: &mut Vec<u8>) {
    for byte in word {
        if byte != 0 {
            out.push(byte);
        }
    }
}

/// Append zero words to the output.
fn append_zero_words(out: &mut Vec<u8>, words: usize) -> Result<(), DecodeError> {
    let bytes = words
        .checked_mul(WORD_BYTES)
        .ok_or(DecodeError::LimitExceeded)?;
    let len = checked_output_len(out.len(), bytes)?;
    out.resize(len, 0);
    Ok(())
}

/// Append bytes while enforcing the unpacked output cap.
fn append_bytes(out: &mut Vec<u8>, bytes: &[u8]) -> Result<(), DecodeError> {
    checked_output_len(out.len(), bytes.len()).map(|_| ())?;
    out.extend_from_slice(bytes);
    Ok(())
}

/// Initial unpack output capacity, capped by the decoder limit.
fn initial_decode_capacity(packed_len: usize) -> Result<usize, DecodeError> {
    let doubled = packed_len
        .checked_mul(2)
        .ok_or(DecodeError::LimitExceeded)?;
    Ok(doubled.min(MAX_UNPACKED_BYTES))
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

/// Return the bit for a word byte offset.
fn bit(offset: usize) -> Result<u8, DecodeError> {
    let shift = u32::try_from(offset).map_err(|_| DecodeError::LimitExceeded)?;
    1_u8.checked_shl(shift).ok_or(DecodeError::LimitExceeded)
}

/// Read one byte at `offset`.
fn read_u8(bytes: &[u8], offset: usize) -> Result<u8, DecodeError> {
    bytes
        .get(offset)
        .copied()
        .ok_or(DecodeError::PackedTruncated)
}

/// Read one word at `offset`.
fn read_word(bytes: &[u8], offset: usize) -> Result<[u8; WORD_BYTES], DecodeError> {
    let end = advance(offset, WORD_BYTES)?;
    let slice = bytes.get(offset..end).ok_or(DecodeError::PackedTruncated)?;
    <[u8; WORD_BYTES]>::try_from(slice).map_err(|_| DecodeError::PackedTruncated)
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
