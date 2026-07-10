//! Schema-independent structural verification for untrusted TDBIN bodies.

use crate::error::DecodeError;
use crate::layout::{self, WORD_BYTES};
use crate::pointer::{self, Pointer};
use crate::MAX_DEPTH;

/// Bits in one TDBIN word.
const WORD_BITS: usize = WORD_BYTES * 8;

/// Validated composite-list tag fields.
#[derive(Clone, Copy)]
struct CompositeTag {
    /// Number of inline elements.
    count: usize,
    /// Data words per element.
    data_words: u16,
    /// Pointer words per element.
    ptr_words: u16,
    /// Total element-body words declared by the list pointer.
    body_words: usize,
}

/// Verify every reachable pointer and enforce traversal limits.
pub(crate) fn message(bytes: &[u8]) -> Result<(), DecodeError> {
    let words = bytes.len() / WORD_BYTES;
    let mut budget = words.checked_sub(1).ok_or(DecodeError::BadLength)?;
    verify_pointer_word(bytes, 0, MAX_DEPTH.saturating_add(1), &mut budget)
}

/// Decode and verify one pointer word.
fn verify_pointer_word(
    bytes: &[u8],
    at: usize,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    let word = layout::read_word(bytes, at)?;
    verify_pointer(bytes, at, pointer::decode(word)?, depth, budget)
}

/// Verify one already-decoded pointer.
fn verify_pointer(
    bytes: &[u8],
    at: usize,
    pointer: Pointer,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    match pointer {
        Pointer::Null => Ok(()),
        Pointer::Struct {
            offset,
            data_words,
            ptr_words,
        } => verify_struct(bytes, at, offset, data_words, ptr_words, depth, budget),
        Pointer::List {
            offset,
            elem,
            count,
        } => verify_list(bytes, at, offset, elem, count, depth, budget),
    }
}

/// Verify a struct target and every pointer slot it declares.
fn verify_struct(
    bytes: &[u8],
    at: usize,
    offset: i64,
    data_words: u16,
    ptr_words: u16,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    let next_depth = descend(depth)?;
    let target = target(at, offset)?;
    let words = section_words(data_words, ptr_words)?;
    require_words(bytes, target, words)?;
    consume(budget, words)?;
    verify_struct_pointers(bytes, target, data_words, ptr_words, next_depth, budget)
}

/// Verify the pointer section of one in-bounds struct body.
fn verify_struct_pointers(
    bytes: &[u8],
    target: usize,
    data_words: u16,
    ptr_words: u16,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    let start = target
        .checked_add(usize::from(data_words))
        .ok_or(DecodeError::LimitExceeded)?;
    for slot in 0..usize::from(ptr_words) {
        let at = start.checked_add(slot).ok_or(DecodeError::LimitExceeded)?;
        verify_pointer_word(bytes, at, depth, budget)?;
    }
    Ok(())
}

/// Verify a list target according to its element kind.
fn verify_list(
    bytes: &[u8],
    at: usize,
    offset: i64,
    elem: u8,
    count: u32,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    let next_depth = descend(depth)?;
    let target = target(at, offset)?;
    match elem {
        0 => verify_flat_list(bytes, target, 0, budget),
        1 => verify_flat_list(bytes, target, words_for_bits(count, 1)?, budget),
        2 => verify_flat_list(bytes, target, words_for_bits(count, 8)?, budget),
        3 => verify_flat_list(bytes, target, words_for_bits(count, 16)?, budget),
        4 => verify_flat_list(bytes, target, words_for_bits(count, 32)?, budget),
        5 => verify_flat_list(bytes, target, count_usize(count)?, budget),
        6 => verify_pointer_list(bytes, target, count, next_depth, budget),
        7 => verify_composite_list(bytes, target, count, next_depth, budget),
        _ => Err(DecodeError::PointerKindMismatch),
    }
}

/// Verify and charge a primitive list body.
fn verify_flat_list(
    bytes: &[u8],
    target: usize,
    words: usize,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    require_words(bytes, target, words)?;
    consume(budget, words)
}

/// Verify a pointer-list body and each element pointer.
fn verify_pointer_list(
    bytes: &[u8],
    target: usize,
    count: u32,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    let words = count_usize(count)?;
    require_words(bytes, target, words)?;
    consume(budget, words)?;
    for slot in 0..words {
        let at = target.checked_add(slot).ok_or(DecodeError::LimitExceeded)?;
        verify_pointer_word(bytes, at, depth, budget)?;
    }
    Ok(())
}

/// Verify a composite-list range and tag.
fn verify_composite_list(
    bytes: &[u8],
    tag_at: usize,
    elem_words: u32,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    let body_words = count_usize(elem_words)?;
    let total_words = body_words
        .checked_add(1)
        .ok_or(DecodeError::LimitExceeded)?;
    require_words(bytes, tag_at, total_words)?;
    consume(budget, total_words)?;
    let tag = pointer::decode(layout::read_word(bytes, tag_at)?)?;
    verify_composite_tag(bytes, tag_at, body_words, tag, depth, budget)
}

/// Decode validated composite tag fields and verify its inline elements.
fn verify_composite_tag(
    bytes: &[u8],
    tag_at: usize,
    body_words: usize,
    tag: Pointer,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    let Pointer::Struct {
        offset,
        data_words,
        ptr_words,
    } = tag
    else {
        return Err(DecodeError::MalformedCompositeTag);
    };
    let count = usize::try_from(offset).map_err(|_| DecodeError::MalformedCompositeTag)?;
    let tag = CompositeTag {
        count,
        data_words,
        ptr_words,
        body_words,
    };
    verify_composite_items(bytes, tag_at, tag, depth, budget)
}

/// Verify every inline element's pointer section.
fn verify_composite_items(
    bytes: &[u8],
    tag_at: usize,
    tag: CompositeTag,
    depth: u32,
    budget: &mut usize,
) -> Result<(), DecodeError> {
    let stride = section_words(tag.data_words, tag.ptr_words)?;
    let expected = stride
        .checked_mul(tag.count)
        .ok_or(DecodeError::LimitExceeded)?;
    if expected != tag.body_words || (stride == 0 && tag.count != 0) {
        return Err(DecodeError::MalformedCompositeTag);
    }
    let first = tag_at.checked_add(1).ok_or(DecodeError::LimitExceeded)?;
    for index in 0..tag.count {
        let offset = stride
            .checked_mul(index)
            .ok_or(DecodeError::LimitExceeded)?;
        let target = first
            .checked_add(offset)
            .ok_or(DecodeError::LimitExceeded)?;
        verify_struct_pointers(bytes, target, tag.data_words, tag.ptr_words, depth, budget)?;
    }
    Ok(())
}

/// Convert an element count and bit width to a rounded-up word count.
fn words_for_bits(count: u32, bits: usize) -> Result<usize, DecodeError> {
    count_usize(count)?
        .checked_mul(bits)
        .map(|total| total.div_ceil(WORD_BITS))
        .ok_or(DecodeError::LimitExceeded)
}

/// Convert a wire count to the platform index type.
fn count_usize(count: u32) -> Result<usize, DecodeError> {
    usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)
}

/// Return a struct's total section width.
fn section_words(data_words: u16, ptr_words: u16) -> Result<usize, DecodeError> {
    usize::from(data_words)
        .checked_add(usize::from(ptr_words))
        .ok_or(DecodeError::LimitExceeded)
}

/// Resolve one relative pointer target.
fn target(at: usize, offset: i64) -> Result<usize, DecodeError> {
    layout::target(at, offset).ok_or(DecodeError::PointerOutOfBounds { word_index: at })
}

/// Require a word range to fit in the message.
fn require_words(bytes: &[u8], at: usize, words: usize) -> Result<(), DecodeError> {
    let end = at.checked_add(words).ok_or(DecodeError::LimitExceeded)?;
    (end <= bytes.len() / WORD_BYTES)
        .then_some(())
        .ok_or(DecodeError::PointerOutOfBounds { word_index: at })
}

/// Charge traversed words to the shared amplification budget.
fn consume(budget: &mut usize, words: usize) -> Result<(), DecodeError> {
    *budget = budget
        .checked_sub(words)
        .ok_or(DecodeError::AmplificationExceeded)?;
    Ok(())
}

/// Decrement the pointer traversal depth.
fn descend(depth: u32) -> Result<u32, DecodeError> {
    depth.checked_sub(1).ok_or(DecodeError::DepthExceeded)
}
