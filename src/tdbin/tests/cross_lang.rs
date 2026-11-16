//! [TDBIN-TS-LIST] [TDBIN-TEST-GOLDEN] Cross-language byte identity: the Rust
//! codec generated from `reports.td` must produce EXACTLY the bytes committed
//! in `golden/report_lists.hex`; the TypeScript suite
//! (`typescript-tdbin.test.ts`) asserts its generated codec produces the same
//! file byte for byte. One value covers every layout-1 `List<T>` form.

/// The codegen-emitted list fixture.
mod generated_reports;

use generated_reports::{Level, Report, Tag};
use std::fmt::Write as _;
use tdbin::{Struct, TdBin};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const GOLDEN: &str = include_str!("golden/report_lists.hex");

/// The shared value; `typescript-tdbin.test.ts` builds the identical one.
fn report() -> Report {
    Report {
        flags: vec![true, false, true, true, false, false, false, false, true],
        counts: vec![0, -1, i64::MAX, i64::MIN],
        ratios: vec![0.5, -0.0, f64::INFINITY, 1e-300],
        names: vec![String::new(), "α".to_owned(), "two words".to_owned()],
        blobs: vec![vec![], vec![0, 255, 7]],
        tags: vec![
            Tag {
                key: "a".to_owned(),
                weight: 1.5,
            },
            Tag {
                key: String::new(),
                weight: -2.0,
            },
        ],
        levels: vec![Level::High, Level::Low, Level::High],
        maybe_counts: Some(vec![42]),
        maybe_tags: Some(vec![]),
        maybe_levels: None,
        title: "golden".to_owned(),
    }
}

fn hex(bytes: &[u8]) -> Result<String, std::fmt::Error> {
    bytes.iter().try_fold(String::new(), |mut out, byte| {
        write!(out, "{byte:02x}")?;
        Ok(out)
    })
}

#[test]
fn rust_list_bytes_match_the_cross_language_golden() -> TestResult {
    let value = report();
    let bytes = value.to_packed_framed_bytes_checked()?;
    assert_eq!(hex(&bytes)?, GOLDEN.trim());
    assert_eq!(Report::from_framed_bytes(&bytes)?, value);
    assert_eq!(
        Report::from_framed_bytes_with_hash(&bytes, Report::LAYOUT_HASH)?,
        value
    );
    Ok(())
}
