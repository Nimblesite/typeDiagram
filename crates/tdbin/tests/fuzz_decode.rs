//! [TDBIN-TEST-FUZZ] Decode-robustness lane: a large, deterministic adversarial
//! corpus driven through the PUBLIC codec API (`TdBin::from_bytes`), proving the
//! decoder is total and safe on arbitrary untrusted bytes ([TDBIN-RS-NOPANIC],
//! [TDBIN-SAFE-DEPTH], [TDBIN-SAFE-UTF8], [TDBIN-UNION-UNKNOWN]).
//!
//! This lane is intentionally DISJOINT from `roundtrip.rs`: that file pins the
//! fixed `BadLength`/`NullRoot`/`ReservedPointerKind`/`PointerKindMismatch` byte
//! patterns; here we cover what it does not — randomized mutation under the
//! decode-determinism and canonical-fixpoint invariants, plus the depth cap, the
//! unknown-union ordinal, and the invalid-UTF-8 path. Every type and its codec is
//! hand-written against the STABLE public `Struct` trait, so this lane never
//! depends on generated fixtures or the wire-format additions in flight.
//!
//! Floating-point scalars are deliberately excluded from the fuzzed types: a
//! random `f64` is frequently `NaN`, and `NaN != NaN` would make the value-based
//! fixpoint assertion non-reflexive. `f64` fidelity is covered by `roundtrip.rs`.

use tdbin::{DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

/// Boxed-error alias so tests use `?` without `unwrap`/`expect`.
type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Fuzz iterations per shape (deterministic; each is cheap).
const ROUNDS: usize = 512;
/// Fixed PRNG seed — the corpus is fully reproducible ([TDBIN-TEST-FUZZ]).
const SEED: u64 = 0x853c_49e6_748f_ea9b;

// ── Hand-written `Struct` shapes, one per decode path ──

/// A pointerless record of two scalar words (data-section decode).
#[derive(Debug, Clone, PartialEq)]
struct Flat {
    /// Signed-integer scalar slot.
    count: i64,
    /// Boolean scalar slot.
    flag: bool,
}

impl Struct for Flat {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.count))?;
        w.scalar(at, 1, tdbin::scalar::bool_bits(self.flag))?;
        Ok(())
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let count = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let flag = tdbin::scalar::bool_from(r.scalar(at, 1)?);
        Ok(Self { count, flag })
    }
}

/// A single required string (pointer-section decode + UTF-8 validation).
#[derive(Debug, Clone, PartialEq)]
struct WithString {
    /// Required UTF-8 string field.
    text: String,
}

impl Struct for WithString {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.text))?;
        Ok(())
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let text = r
            .string(at, Self::DATA_WORDS, 0)?
            .ok_or(DecodeError::UnexpectedNull)?;
        Ok(Self { text })
    }
}

/// A one-scalar leaf used as a union payload.
#[derive(Debug, Clone, PartialEq)]
struct Leaf {
    /// Scalar payload.
    value: i64,
}

impl Struct for Leaf {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.value))?;
        Ok(())
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            value: tdbin::scalar::i64_from(r.scalar(at, 0)?),
        })
    }
}

/// A tagged union: discriminant word plus a payload child pointer.
#[derive(Debug, Clone, PartialEq)]
enum Choice {
    /// Ordinal 0.
    First(Leaf),
    /// Ordinal 1.
    Second(Leaf),
}

impl Struct for Choice {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        match self {
            Self::First(payload) => {
                w.scalar(at, 0, 0)?;
                w.child(at, Self::DATA_WORDS, 0, Some(payload))
            }
            Self::Second(payload) => {
                w.scalar(at, 0, 1)?;
                w.child(at, Self::DATA_WORDS, 0, Some(payload))
            }
        }
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        match r.scalar(at, 0)? {
            0 => Ok(Self::First(
                r.child::<Leaf>(at, Self::DATA_WORDS, 0)?
                    .ok_or(DecodeError::UnexpectedNull)?,
            )),
            1 => Ok(Self::Second(
                r.child::<Leaf>(at, Self::DATA_WORDS, 0)?
                    .ok_or(DecodeError::UnexpectedNull)?,
            )),
            ordinal => Err(DecodeError::UnknownVariant { ordinal }),
        }
    }
}

/// A self-referential struct used to build nesting past the decoder depth cap.
#[derive(Debug, Clone, PartialEq)]
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
        let next = r.child::<Deep>(at, Self::DATA_WORDS, 0)?.map(Box::new);
        Ok(Self { next })
    }
}

// ── Deterministic corpus generation ──

/// A minimal LCG PRNG (deterministic, wrapping — no timing or OS entropy).
struct Lcg {
    /// Current internal state.
    state: u64,
}

impl Lcg {
    /// Seed the generator.
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    /// Advance and return the next pseudo-random word.
    fn next(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.state
    }
}

/// Bit-flip roughly one in eight bytes of `base`.
fn flip_bits(lcg: &mut Lcg, base: &[u8]) -> Vec<u8> {
    let mut out = base.to_vec();
    for byte in &mut out {
        if lcg.next() & 0x07 == 0 {
            if let Some(&mask) = lcg.next().to_le_bytes().first() {
                *byte ^= mask;
            }
        }
    }
    out
}

/// Keep a random prefix of whole words (may be empty → `BadLength` path).
fn truncate_words(lcg: &mut Lcg, base: &[u8]) -> Vec<u8> {
    let keep = usize::try_from(lcg.next() & 0x0F).unwrap_or(0);
    base.chunks(8).take(keep).flatten().copied().collect()
}

/// Append a random number of whole random words.
fn append_words(lcg: &mut Lcg, base: &[u8]) -> Vec<u8> {
    let extra = usize::try_from(lcg.next() & 0x07).unwrap_or(0);
    let mut out = base.to_vec();
    for _ in 0..extra {
        out.extend_from_slice(&lcg.next().to_le_bytes());
    }
    out
}

/// Append 1–7 random bytes, breaking word alignment (`BadLength` path).
fn append_tail_bytes(lcg: &mut Lcg, base: &[u8]) -> Vec<u8> {
    let mut out = base.to_vec();
    let take = usize::try_from((lcg.next() & 0x07) | 0x01).unwrap_or(1);
    let word = lcg.next().to_le_bytes();
    out.extend_from_slice(word.get(..take).unwrap_or(&word));
    out
}

/// Produce one adversarial mutation of `base`.
fn mutate(lcg: &mut Lcg, base: &[u8]) -> Vec<u8> {
    match lcg.next() & 0x03 {
        0 => flip_bits(lcg, base),
        1 => truncate_words(lcg, base),
        2 => append_words(lcg, base),
        _ => append_tail_bytes(lcg, base),
    }
}

/// A buffer of 0–15 fully random whole words.
fn random_words(lcg: &mut Lcg) -> Vec<u8> {
    let words = usize::try_from(lcg.next() & 0x0F).unwrap_or(0);
    let mut out = Vec::new();
    for _ in 0..words {
        out.extend_from_slice(&lcg.next().to_le_bytes());
    }
    out
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

/// First index at which `needle` occurs in `haystack`, if any.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

// ── Invariants ──

/// Decode `buf`, asserting decode determinism and — when it decodes — the
/// canonical re-encode fixpoint: `from_bytes(x) = Ok(v)` implies re-encoding `v`
/// and decoding again yields exactly `v` ([TDBIN-ENC-CANON], [TDBIN-RS-NOPANIC]).
fn exercise<T>(buf: &[u8]) -> TestResult
where
    T: TdBin + Clone + PartialEq + core::fmt::Debug,
{
    let decoded = T::from_bytes(buf);
    assert_eq!(
        decoded,
        T::from_bytes(buf),
        "decode of identical bytes must be deterministic"
    );
    if let Ok(value) = &decoded {
        let reencoded = value.to_bytes()?;
        let expected: Result<&T, &DecodeError> = Ok(value);
        assert_eq!(
            T::from_bytes(&reencoded).as_ref(),
            expected,
            "decode must be a fixpoint under canonical re-encode"
        );
    }
    Ok(())
}

/// Run `ROUNDS` mutation and `ROUNDS` random inputs of `T` through `exercise`.
fn fuzz<T>(base: &[u8], lcg: &mut Lcg) -> TestResult
where
    T: TdBin + Clone + PartialEq + core::fmt::Debug,
{
    for _ in 0..ROUNDS {
        exercise::<T>(&mutate(lcg, base))?;
        exercise::<T>(&random_words(lcg))?;
    }
    Ok(())
}

// ── Tests ──

/// [TDBIN-TEST-FUZZ] Across scalar, string, union, and nested shapes, decode is
/// total (never panics), deterministic, and a canonical re-encode fixpoint over
/// a large mutated + random corpus.
#[test]
fn decode_is_total_deterministic_and_fixpoint_under_fuzz() -> TestResult {
    let mut lcg = Lcg::new(SEED);
    fuzz::<Flat>(&Flat { count: -7, flag: true }.to_bytes()?, &mut lcg)?;
    fuzz::<WithString>(
        &WithString {
            text: "hello, tdbin".to_owned(),
        }
        .to_bytes()?,
        &mut lcg,
    )?;
    fuzz::<Choice>(&Choice::Second(Leaf { value: 42 }).to_bytes()?, &mut lcg)?;
    fuzz::<Deep>(&deep_chain(8).to_bytes()?, &mut lcg)?;
    Ok(())
}

/// [TDBIN-SAFE-DEPTH] The encoder has no depth cap, but decoding a chain nested
/// past `MAX_DEPTH` (64) must return `DepthExceeded`, never overflow the stack.
#[test]
fn depth_cap_rejects_overdeep_nesting() -> TestResult {
    let bytes = deep_chain(128).to_bytes()?;
    assert_eq!(Deep::from_bytes(&bytes), Err(DecodeError::DepthExceeded));
    Ok(())
}

/// [TDBIN-UNION-UNKNOWN] A discriminant with no matching variant is rejected as
/// `UnknownVariant`, carrying the offending ordinal — not silently accepted.
#[test]
fn unknown_union_ordinal_is_rejected() -> TestResult {
    let bytes = Choice::First(Leaf { value: 1 }).to_bytes()?;
    let mut evil = bytes.clone();
    // The union discriminant is root data word 0 (bytes 8..16 in canonical v0).
    evil.get_mut(8..16)
        .ok_or("message too short for a discriminant")?
        .copy_from_slice(&9u64.to_le_bytes());
    match Choice::from_bytes(&evil) {
        Err(DecodeError::UnknownVariant { ordinal: 9 }) => Ok(()),
        other => Err(format!("expected UnknownVariant{{ordinal:9}}, got {other:?}").into()),
    }
}

/// [TDBIN-SAFE-UTF8] A string field carrying a non-UTF-8 byte is rejected as
/// `InvalidUtf8`, never surfaced as a lossy or panicking decode.
#[test]
fn invalid_utf8_string_is_rejected() -> TestResult {
    let marker = "MARKERvalue";
    let bytes = WithString {
        text: marker.to_owned(),
    }
    .to_bytes()?;
    let mut evil = bytes.clone();
    let at = find_subslice(&evil, marker.as_bytes()).ok_or("marker not found on the wire")?;
    // 0xFF is never a valid UTF-8 byte; corrupt the leading byte of the payload.
    let byte = evil.get_mut(at).ok_or("payload index past end")?;
    *byte = 0xFF;
    assert_eq!(
        WithString::from_bytes(&evil),
        Err(DecodeError::InvalidUtf8)
    );
    Ok(())
}
