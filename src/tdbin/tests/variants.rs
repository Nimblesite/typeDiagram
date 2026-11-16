//! [TDBIN-UNION-STRUCT] (#61) Struct-form and multi-field tuple union variants
//! round-trip through GENERATED codecs: discriminant in data word 0, payload as
//! a pointer to a struct laid out by [TDBIN-REC-ALLOC]. Every variant is
//! exercised as both a required and an optional field, bare and framed.

/// The codegen-emitted struct-form variant fixture.
mod generated_shapes;

use generated_shapes::{Canvas, Point, Shape};
use tdbin::{DecodeError, Struct, TdBin};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn shapes() -> Vec<Shape> {
    vec![
        Shape::Circle {
            radius: 2.5,
            label: "sun".to_owned(),
        },
        Shape::Rect {
            w: -1.0,
            h: 1e9,
            corner: Point { x: 0.5, y: -0.5 },
        },
        Shape::Pair(i64::MIN, "pair".to_owned()),
        Shape::Tagged(Point { x: 3.0, y: 4.0 }),
        Shape::Empty,
    ]
}

#[test]
fn struct_form_variants_round_trip_bare_framed_and_optional() -> TestResult {
    let all = shapes();
    for shape in &all {
        for backup in std::iter::once(None).chain(all.iter().cloned().map(Some)) {
            let canvas = Canvas {
                name: format!("{shape:?}"),
                shape: shape.clone(),
                backup,
            };
            let bytes = canvas.to_bytes()?;
            assert_eq!(Canvas::from_bytes(&bytes)?, canvas);
            assert_eq!(Canvas::from_bytes(&bytes)?.to_bytes()?, bytes);
            let framed = canvas.to_packed_framed_bytes_checked()?;
            assert_eq!(Canvas::from_framed_bytes(&framed)?, canvas);
        }
        assert_eq!(Shape::from_bytes(&shape.to_bytes()?)?, *shape);
    }
    let circle = Shape::Circle {
        radius: 0.0,
        label: String::new(),
    };
    assert_eq!(Shape::default(), circle);
    assert_ne!(
        circle.to_bytes()?,
        Shape::Rect {
            w: 0.0,
            h: 0.0,
            corner: Point::default()
        }
        .to_bytes()?
    );
    let wrong = Canvas::default().to_framed_bytes(Some(Shape::LAYOUT_HASH))?;
    assert!(matches!(
        Canvas::from_framed_bytes(&wrong),
        Err(DecodeError::HashMismatch { .. })
    ));
    Ok(())
}
