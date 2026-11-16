//! [TDBIN-CODEGEN-LOCALS] Generated codecs whose fields and variants reuse the
//! codec's own identifiers (`w`, `r`, `at`, `count`, `items`, `rows`, `i`,
//! `tags`) compile and round-trip through both the struct (layout 1 pointer)
//! path and the columnar (layout 2 column group) path.

/// The codegen-emitted name-collision fixture.
mod generated_names;

use generated_names::{Inner, Names, NamesBatch, Pick};
use tdbin::TdBin;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn inner(at: i64, r: &str) -> Inner {
    Inner {
        at,
        r: r.to_owned(),
    }
}

fn names(seed: i64) -> Names {
    Names {
        value: format!("v{seed}"),
        writer: seed,
        reader: seed.wrapping_neg(),
        tdbin: seed.wrapping_mul(3),
        ok: seed % 2 == 0,
        w: seed.wrapping_add(1),
        at: seed.wrapping_add(2),
        r: seed.wrapping_add(3),
        count: seed.wrapping_add(4),
        i: seed % 2 == 1,
        items: (seed % 2 == 0).then(|| inner(seed, "items")),
        rows: vec![inner(1, "a"), inner(seed, "b")],
        tags: vec!["t".to_owned(), format!("{seed}")],
        x: Some(seed),
        x_present: (seed % 3 == 0).then_some(seed.wrapping_neg()),
        pick: match seed % 4 {
            0 => Pick::W(inner(seed, "w")),
            1 => Pick::Items(inner(seed, "it")),
            2 => Pick::Tags,
            _ => Pick::Count(inner(seed, "c")),
        },
    }
}

#[test]
fn colliding_names_round_trip_through_struct_and_column_codecs() -> TestResult {
    for seed in 0..8 {
        let single = names(seed);
        let bytes = single.to_bytes()?;
        assert_eq!(Names::from_bytes(&bytes)?, single);
        assert_eq!(Names::from_bytes(&bytes)?.to_bytes()?, bytes);
    }
    let batch = NamesBatch {
        names: (0..8).map(names).collect(),
        picks: vec![
            Pick::Tags,
            Pick::W(inner(1, "w")),
            Pick::Count(inner(2, "c")),
            Pick::Items(inner(3, "i")),
        ],
    };
    let bytes = batch.to_bytes()?;
    let decoded = NamesBatch::from_bytes(&bytes)?;
    assert_eq!(decoded, batch);
    assert_eq!(decoded.names.len(), 8);
    assert_eq!(decoded.names.get(3).map(|n| n.x_present), Some(Some(-3)));
    assert_eq!(
        NamesBatch::from_bytes(&NamesBatch::default().to_bytes()?)?,
        NamesBatch::default()
    );
    Ok(())
}
