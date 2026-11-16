//! [TDBIN-TEST-FUZZ] Decode-robustness lane driven through the PUBLIC codec API
//! on the typeDiagram-GENERATED ADTs (`mod generated;`) — never hand-written
//! `impl Struct`. A DETERMINISTIC, enumerated adversarial corpus (no PRNG, no
//! randomness) proves the decoder is total and safe on arbitrary untrusted bytes
//! ([TDBIN-RS-NOPANIC], [TDBIN-SAFE-UTF8], [TDBIN-UNION-UNKNOWN]).
//!
//! Invariants are asserted at the BYTE level (canonical re-encode), never by
//! comparing decoded values: `Person` carries an `f64` (`score`) and `NaN != NaN`
//! would make value equality non-reflexive on mutated input. Byte-level checks are
//! both NaN-safe and strictly stronger (they pin the canonical encoding).
//!
//! Disjoint from `roundtrip.rs`: that file pins the fixed error byte-patterns;
//! here we enumerate every single-byte and length mutation of a valid message and
//! assert decode determinism + the canonical byte-fixpoint, plus the unknown-union
//! ordinal, invalid-UTF-8, and depth-cap ([TDBIN-SAFE-DEPTH]) paths. `Deep` is the
//! one hand-written `Struct` here, allowed by exception: the depth cap needs
//! unbounded self-nesting and no generated ADT is recursive.

mod generated;

use generated::{Address, Contact, EmailContact, Person, PhoneContact};
use tdbin::{DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

/// Boxed-error alias so tests use `?` without `unwrap`/`expect`.
type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Fixed single-byte XOR masks applied at every offset (deterministic, no PRNG).
const MASKS: [u8; 3] = [0x01, 0x80, 0xFF];

// ── Valid bases (constructed values; the codec itself stays codegen-only) ──

/// A representative valid `Person` used as the mutation base.
fn sample_person() -> Person {
    Person {
        name: "Fuzz Base".to_owned(),
        age: 7,
        active: true,
        score: 1.0,
        address: Some(Address {
            street: "N St".to_owned(),
            zip: 3,
        }),
        nickname: Some("fb".to_owned()),
        contact: Contact::Phone(PhoneContact {
            number: 5,
            country: 6,
        }),
    }
}

/// A representative valid `Contact` used as the mutation base.
fn sample_contact() -> Contact {
    Contact::Email(EmailContact {
        addr: "e@x.io".to_owned(),
    })
}

// ── Deterministic corpus generation ──

/// Every single-byte XOR mutation of `base` (one per offset per fixed mask).
fn byte_mutations(base: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    for (i, _) in base.iter().enumerate() {
        for &mask in &MASKS {
            let mut m = base.to_vec();
            if let Some(b) = m.get_mut(i) {
                *b ^= mask;
            }
            out.push(m);
        }
    }
    out
}

/// Every prefix of `base` (aligned and unaligned) plus word/byte appends.
fn length_mutations(base: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    for take in 0..=base.len() {
        if let Some(prefix) = base.get(..take) {
            out.push(prefix.to_vec());
        }
    }
    let mut plus_word = base.to_vec();
    plus_word.extend_from_slice(&[0u8; 8]);
    out.push(plus_word);
    let mut plus_byte = base.to_vec();
    plus_byte.push(0xAA);
    out.push(plus_byte);
    out
}

/// First index at which `needle` occurs in `haystack`, if any.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// The one hand-written `Struct` in this lane (allowed by exception): the depth
/// cap needs unbounded self-nesting via `Box`, and no generated ADT is recursive.
/// Its codec mirrors exactly what codegen emits for a single optional child.
#[derive(Debug, PartialEq)]
struct Deep {
    /// Optional next link.
    next: Option<Box<Deep>>,
}

impl Struct for Deep {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.child(at, Self::DATA_WORDS, 0, self.next.as_deref())?;
        Ok(())
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let next = r.child::<Self>(at, Self::DATA_WORDS, 0)?.map(Box::new);
        Ok(Self { next })
    }
}

/// A `Deep` chain `n` links long (root plus `n` nested children).
fn deep_chain(n: usize) -> Deep {
    let mut node = Deep { next: None };
    for _ in 0..n {
        node = Deep {
            next: Some(Box::new(node)),
        };
    }
    node
}

// ── Invariants (byte-level; NaN-safe) ──

/// Decode `buf`, asserting decode determinism and — when it decodes — the
/// canonical byte-fixpoint: re-encoding the value and decoding again reproduces
/// the same canonical bytes ([TDBIN-ENC-CANON], [TDBIN-RS-NOPANIC]).
fn exercise<T: TdBin>(buf: &[u8]) -> TestResult {
    match (T::from_bytes(buf), T::from_bytes(buf)) {
        (Ok(a), Ok(b)) => {
            let canonical = a.to_bytes()?;
            assert_eq!(
                canonical,
                b.to_bytes()?,
                "identical bytes must decode deterministically"
            );
            let again = T::from_bytes(&canonical)
                .map_err(|e| format!("canonical re-encode failed to decode: {e:?}"))?;
            assert_eq!(
                again.to_bytes()?,
                canonical,
                "canonical re-encode must be a byte-level fixpoint"
            );
        }
        (Err(a), Err(b)) => assert_eq!(a, b, "identical bytes must fail identically"),
        _ => return Err("decode determinism broken: Ok vs Err on identical bytes".into()),
    }
    Ok(())
}

/// Run the base and its full deterministic mutation corpus through `exercise`.
fn fuzz<T: TdBin>(base: &[u8]) -> TestResult {
    exercise::<T>(base)?;
    for m in byte_mutations(base) {
        exercise::<T>(&m)?;
    }
    for m in length_mutations(base) {
        exercise::<T>(&m)?;
    }
    Ok(())
}

// ── Tests ──

/// [TDBIN-TEST-FUZZ] Over the full deterministic mutation corpus of a valid
/// Person and Contact, decode is total (never panics), deterministic, and a
/// canonical byte-fixpoint.
#[test]
fn generated_decode_is_total_deterministic_and_fixpoint() -> TestResult {
    fuzz::<Person>(&sample_person().to_bytes()?)?;
    fuzz::<Contact>(&sample_contact().to_bytes()?)?;
    Ok(())
}

/// [TDBIN-UNION-UNKNOWN] A Contact discriminant with no matching variant is
/// rejected as `UnknownVariant` carrying the offending ordinal.
#[test]
fn unknown_contact_ordinal_is_rejected() -> TestResult {
    let bytes = sample_contact().to_bytes()?;
    let mut evil = bytes.clone();
    // The union discriminant is root data word 0 (bytes 8..16 in canonical v0).
    evil.get_mut(8..16)
        .ok_or("message too short for a discriminant")?
        .copy_from_slice(&9u64.to_le_bytes());
    match Contact::from_bytes(&evil) {
        Err(DecodeError::UnknownVariant { ordinal: 9 }) => Ok(()),
        other => Err(format!("expected UnknownVariant{{ordinal:9}}, got {other:?}").into()),
    }
}

/// [TDBIN-SAFE-UTF8] A string field carrying a non-UTF-8 byte is rejected as
/// `InvalidUtf8`, never surfaced as a lossy or panicking decode.
#[test]
fn invalid_utf8_in_string_field_is_rejected() -> TestResult {
    let marker = "UtF8MARKER";
    let bytes = Contact::Email(EmailContact {
        addr: marker.to_owned(),
    })
    .to_bytes()?;
    let mut evil = bytes.clone();
    let at = find_subslice(&evil, marker.as_bytes()).ok_or("marker not found on the wire")?;
    // 0xFF is never a valid UTF-8 byte; corrupt the leading payload byte.
    let byte = evil.get_mut(at).ok_or("payload index past end")?;
    *byte = 0xFF;
    assert_eq!(Contact::from_bytes(&evil), Err(DecodeError::InvalidUtf8));
    Ok(())
}

/// [TDBIN-SAFE-DEPTH] Encoding and decoding accept 64 child pointers and reject
/// a deeper value before recursive traversal can exhaust the stack.
#[test]
fn depth_cap_rejects_overdeep_nesting() -> TestResult {
    let boundary = deep_chain(64);
    let bytes = boundary.to_bytes()?;
    assert_eq!(Deep::from_bytes(&bytes)?, boundary);
    assert_eq!(deep_chain(65).to_bytes(), Err(EncodeError::LimitExceeded));
    Ok(())
}
