//! [TDBIN-WIDTH-RANGE] [TDBIN-WIDTH-LIST] [TDBIN-WIDTH-PATH] (#85) Generated
//! width-refined integers and `Path` round-trip at their extremes, reject
//! out-of-range words with a typed error instead of truncating, and use the
//! reserved 2- and 4-byte list element widths.

/// The codegen-emitted width fixture.
mod generated_widths;

use std::fmt::Write as _;
use std::path::PathBuf;

use generated_widths::{Stats, StatsRaw};
use tdbin::{DecodeError, TdBin};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn extremes() -> Stats {
    Stats {
        delta: i32::MIN,
        flags: u8::MAX,
        port: u16::MAX,
        hits: u32::MAX,
        hash: u64::MAX,
        count: usize::MAX,
        file: PathBuf::from("/tmp/α/report.json"),
        maybe_hash: Some(0),
        maybe_port: None,
        maybe_file: Some(PathBuf::from("rel/path")),
        deltas: vec![i32::MIN, -1, 0, i32::MAX],
        bytes: vec![0, 1, 255],
        ports: vec![0, 1, u16::MAX],
        hits_list: vec![u32::MAX, 7],
        hashes: vec![u64::MAX, 0],
        sizes: vec![usize::MAX, 3],
        files: vec![PathBuf::from("a"), PathBuf::from("b/c")],
        maybe_sizes: Some(vec![]),
        maybe_files: None,
    }
}

#[test]
fn width_types_round_trip_at_extremes_and_reject_out_of_range() -> TestResult {
    let value = extremes();
    let bytes = value.to_bytes()?;
    assert_eq!(Stats::from_bytes(&bytes)?, value);
    assert_eq!(Stats::from_bytes(&bytes)?.to_bytes()?, bytes);
    let framed = value.to_packed_framed_bytes_checked()?;
    assert_eq!(Stats::from_framed_bytes(&framed)?, value);
    assert_eq!(
        Stats::from_bytes(&Stats::default().to_bytes()?)?,
        Stats::default()
    );

    // 2-byte U16 list: three elements fit one padded word after the pointer.
    let short = Stats {
        ports: vec![1, 2, 3],
        ..Stats::default()
    };
    let wide = Stats {
        hashes: vec![1, 2, 3],
        ..Stats::default()
    };
    assert!(short.to_bytes()?.len() < wide.to_bytes()?.len());

    let in_range = StatsRaw {
        delta: i64::from(i32::MAX),
        flags: 255,
        port: 65_535,
        hits: u64::from(u32::MAX),
        hash: 9,
        count: 10,
    };
    let narrowed = Stats::from_bytes(&in_range.to_bytes()?)?;
    assert_eq!(
        (narrowed.delta, narrowed.flags, narrowed.port, narrowed.hits),
        (i32::MAX, 255, 65_535, u32::MAX)
    );
    for raw in [
        StatsRaw {
            delta: i64::from(i32::MAX) + 1,
            ..in_range.clone()
        },
        StatsRaw {
            delta: i64::from(i32::MIN) - 1,
            ..in_range.clone()
        },
        StatsRaw {
            flags: 256,
            ..in_range.clone()
        },
        StatsRaw {
            port: 65_536,
            ..in_range.clone()
        },
        StatsRaw {
            hits: u64::from(u32::MAX) + 1,
            ..in_range.clone()
        },
    ] {
        assert_eq!(
            Stats::from_bytes(&raw.to_bytes()?),
            Err(DecodeError::ValueOutOfRange)
        );
    }
    Ok(())
}

#[cfg(unix)]
#[test]
fn non_utf8_paths_fail_encode_typed() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let bad = Stats {
        file: PathBuf::from(OsStr::from_bytes(&[0x66, 0xff])),
        ..Stats::default()
    };
    assert_eq!(bad.to_bytes(), Err(tdbin::EncodeError::NonUtf8Path));
    let bad_list = Stats {
        files: vec![PathBuf::from(OsStr::from_bytes(&[0xfe]))],
        ..Stats::default()
    };
    assert_eq!(bad_list.to_bytes(), Err(tdbin::EncodeError::NonUtf8Path));
}

/// The shared Rust ↔ TypeScript golden value (`typescript-tdbin.test.ts`
/// builds the identical one; `Size` stays within JS safe integers).
const SAFE: usize = 9_007_199_254_740_991;

#[test]
fn width_bytes_match_the_cross_language_golden() -> TestResult {
    let value = Stats {
        count: SAFE,
        sizes: vec![SAFE, 3],
        ..extremes()
    };
    let bytes = value.to_packed_framed_bytes_checked()?;
    let hex = bytes.iter().try_fold(String::new(), |mut out, byte| {
        write!(out, "{byte:02x}")?;
        Ok::<_, std::fmt::Error>(out)
    })?;
    assert_eq!(hex, include_str!("golden/widths.hex").trim());
    assert_eq!(Stats::from_framed_bytes(&bytes)?, value);
    Ok(())
}
