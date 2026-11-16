//! [TDBIN-TEST-GOLDEN] Shared lowercase-hex codec helpers for the golden vector
//! tests.
//!
//! The bare (`golden.rs`) and columnar (`golden_columnar.rs`) golden lanes both
//! pin encoder output to hex constants and decode those constants back, so they
//! share the identical `to_hex`/`hex_nibble`/`from_hex` helpers included here.
//! Each lane keeps its own `assert_golden` (the columnar one additionally proves
//! a packed-framed round-trip), which calls these shared helpers.

/// Lowercase hex encoding of `bytes`.
pub fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::new();
    for &byte in bytes {
        if let (Some(&hi), Some(&lo)) = (
            HEX.get(usize::from(byte >> 4)),
            HEX.get(usize::from(byte & 0x0F)),
        ) {
            out.push(char::from(hi));
            out.push(char::from(lo));
        }
    }
    out
}

/// Decode one lowercase hex nibble, or `None` if it is not `[0-9a-f]`.
pub fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c.wrapping_sub(b'0')),
        b'a'..=b'f' => Some(c.wrapping_sub(b'a').wrapping_add(10)),
        _ => None,
    }
}

/// Decode a lowercase hex string to bytes.
pub fn from_hex(s: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let raw = s.as_bytes();
    if !raw.len().is_multiple_of(2) {
        return Err("hex string has odd length".into());
    }
    let mut out = Vec::new();
    for pair in raw.chunks(2) {
        let hi = pair
            .first()
            .copied()
            .and_then(hex_nibble)
            .ok_or("bad hex digit")?;
        let lo = pair
            .get(1)
            .copied()
            .and_then(hex_nibble)
            .ok_or("bad hex digit")?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}
