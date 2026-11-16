//! [TDBIN-UNION-STRUCT] GENERATED struct-form / multi-field tuple union
//! variant fixture (#61), emitted by
//! `packages/typediagram/src/converters/rust-tdbin.ts` (`generateRustModule`)
//! from `packages/typediagram/test/converters/fixtures/shapes.td`. Included
//! only by `variants.rs`. Regenerate with
//! `node scripts/tdbin-regen-fixtures.mjs` rather than hand-editing.

// <<<GENERATED — rust-tdbin.ts generateRustModule; do not edit by hand>>>
/// The `Point` record.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Point {
    /// The `x` field.
    pub x: f64,
    /// The `y` field.
    pub y: f64,
}

/// The `Shape` union.
#[derive(Debug, Clone, PartialEq)]
pub enum Shape {
    /// The `Circle` variant.
    Circle { radius: f64, label: String },
    /// The `Rect` variant.
    Rect { w: f64, h: f64, corner: Point },
    /// The `Pair` variant.
    Pair(i64, String),
    /// The `Tagged` variant.
    Tagged(Point),
    /// The `Empty` variant.
    Empty,
}

/// The `Canvas` record.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Canvas {
    /// The `name` field.
    pub name: String,
    /// The `shape` field.
    pub shape: Shape,
    /// The `backup` field.
    pub backup: Option<Shape>,
}

/// The `ShapeCircleTdbinPayload` record.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ShapeCircleTdbinPayload {
    /// The `radius` field.
    pub radius: f64,
    /// The `label` field.
    pub label: String,
}

/// The `ShapeRectTdbinPayload` record.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ShapeRectTdbinPayload {
    /// The `w` field.
    pub w: f64,
    /// The `h` field.
    pub h: f64,
    /// The `corner` field.
    pub corner: Point,
}

/// The `ShapePairTdbinPayload` record.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ShapePairTdbinPayload {
    /// The `v0` field.
    pub v0: i64,
    /// The `v1` field.
    pub v1: String,
}

impl tdbin::Struct for Point {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 0;
    const LAYOUT_HASH: u64 = 0xec16_976d_1ca9_f214;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.x))?;
        w.scalar(at, 1, tdbin::scalar::f64_bits(self.y))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let x = tdbin::scalar::f64_from(r.scalar(at, 0)?);
        let y = tdbin::scalar::f64_from(r.scalar(at, 1)?);
        Ok(Self { x, y })
    }
}

impl Default for Shape {
    fn default() -> Self {
        {
            let payload = ShapeCircleTdbinPayload::default();
            Self::Circle {
                radius: payload.radius,
                label: payload.label,
            }
        }
    }
}

impl tdbin::Struct for Shape {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;
    const LAYOUT_HASH: u64 = 0xe89c_a02c_2d7f_1ddf;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        match self {
            Self::Circle {
                radius: f0,
                label: f1,
            } => {
                w.scalar(at, 0, 0)?;
                w.child(
                    at,
                    Self::DATA_WORDS,
                    0,
                    Some(&ShapeCircleTdbinPayload {
                        radius: *f0,
                        label: f1.clone(),
                    }),
                )
            }
            Self::Rect {
                w: f0,
                h: f1,
                corner: f2,
            } => {
                w.scalar(at, 0, 1)?;
                w.child(
                    at,
                    Self::DATA_WORDS,
                    0,
                    Some(&ShapeRectTdbinPayload {
                        w: *f0,
                        h: *f1,
                        corner: f2.clone(),
                    }),
                )
            }
            Self::Pair(f0, f1) => {
                w.scalar(at, 0, 2)?;
                w.child(
                    at,
                    Self::DATA_WORDS,
                    0,
                    Some(&ShapePairTdbinPayload {
                        v0: *f0,
                        v1: f1.clone(),
                    }),
                )
            }
            Self::Tagged(payload) => {
                w.scalar(at, 0, 3)?;
                w.child(at, Self::DATA_WORDS, 0, Some(payload))
            }
            Self::Empty => {
                w.scalar(at, 0, 4)?;
                Ok(())
            }
        }
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        match r.scalar(at, 0)? {
            0 => {
                let payload = r
                    .child::<ShapeCircleTdbinPayload>(at, Self::DATA_WORDS, 0)?
                    .unwrap_or_default();
                Ok(Self::Circle {
                    radius: payload.radius,
                    label: payload.label,
                })
            }
            1 => {
                let payload = r
                    .child::<ShapeRectTdbinPayload>(at, Self::DATA_WORDS, 0)?
                    .unwrap_or_default();
                Ok(Self::Rect {
                    w: payload.w,
                    h: payload.h,
                    corner: payload.corner,
                })
            }
            2 => {
                let payload = r
                    .child::<ShapePairTdbinPayload>(at, Self::DATA_WORDS, 0)?
                    .unwrap_or_default();
                Ok(Self::Pair(payload.v0, payload.v1))
            }
            3 => Ok(Self::Tagged(
                r.child::<Point>(at, Self::DATA_WORDS, 0)?
                    .unwrap_or_default(),
            )),
            4 => {
                r.require_null_pointer(at, 0)?;
                Ok(Self::Empty)
            }
            ordinal => {
                r.verify_struct_slots(at)?;
                Err(tdbin::DecodeError::UnknownVariant { ordinal })
            }
        }
    }
}

impl tdbin::Struct for Canvas {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 3;
    const LAYOUT_HASH: u64 = 0x7af5_ca4f_32b1_2af0;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.name))?;
        w.child(at, Self::DATA_WORDS, 1, Some(&self.shape))?;
        w.child(at, Self::DATA_WORDS, 2, self.backup.as_ref())?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let name = r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        let shape = r
            .child::<Shape>(at, Self::DATA_WORDS, 1)?
            .unwrap_or_default();
        let backup = r.child::<Shape>(at, Self::DATA_WORDS, 2)?;
        Ok(Self {
            name,
            shape,
            backup,
        })
    }
}

impl tdbin::Struct for ShapeCircleTdbinPayload {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;
    const LAYOUT_HASH: u64 = 0x25a8_f1a2_4449_715d;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.radius))?;
        w.string(at, Self::DATA_WORDS, 0, Some(&self.label))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let radius = tdbin::scalar::f64_from(r.scalar(at, 0)?);
        let label = r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        Ok(Self { radius, label })
    }
}

impl tdbin::Struct for ShapeRectTdbinPayload {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 1;
    const LAYOUT_HASH: u64 = 0x2ca2_5295_c1ff_139e;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.w))?;
        w.scalar(at, 1, tdbin::scalar::f64_bits(self.h))?;
        w.child(at, Self::DATA_WORDS, 0, Some(&self.corner))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let w = tdbin::scalar::f64_from(r.scalar(at, 0)?);
        let h = tdbin::scalar::f64_from(r.scalar(at, 1)?);
        let corner = r
            .child::<Point>(at, Self::DATA_WORDS, 0)?
            .unwrap_or_default();
        Ok(Self { w, h, corner })
    }
}

impl tdbin::Struct for ShapePairTdbinPayload {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;
    const LAYOUT_HASH: u64 = 0x3ce1_1b39_b3cf_1066;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.v0))?;
        w.string(at, Self::DATA_WORDS, 0, Some(&self.v1))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let v0 = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let v1 = r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        Ok(Self { v0, v1 })
    }
}
