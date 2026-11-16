//! [TDBIN-RS-REFLECT] tests for the optional reflective `Value` bridge.

use tdbin::reflect::{self, FieldDef, ReflectError, TypeDef, TypeRef, Value, ValueCodec};
use tdbin::{DecodeError, EncodeError, Reader, Struct, Writer};

/// Boxed-error alias for fallible tests.
type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Generated-style record used to prove the reflective bridge stays typed.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Mini {
    /// Display name.
    name: String,
    /// Signed count.
    count: i64,
    /// Packed flag.
    active: bool,
}

impl Struct for Mini {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.name))?;
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.count))?;
        w.bool_bit(at, 1, 0, self.active)
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let name = r
            .string(at, Self::DATA_WORDS, 0)?
            .ok_or(DecodeError::UnexpectedNull)?;
        let count = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let active = r.bool_bit(at, 1, 0)?;
        Ok(Self {
            name,
            count,
            active,
        })
    }
}

impl ValueCodec for Mini {
    fn type_def() -> TypeDef {
        TypeDef::Record {
            name: "Mini".to_owned(),
            fields: vec![
                FieldDef {
                    name: "name".to_owned(),
                    ty: TypeRef::Str,
                },
                FieldDef {
                    name: "count".to_owned(),
                    ty: TypeRef::Int,
                },
                FieldDef {
                    name: "active".to_owned(),
                    ty: TypeRef::Bool,
                },
            ],
        }
    }

    fn to_value(&self) -> Value {
        Value::Record {
            fields: vec![
                ("name".to_owned(), Value::Str(self.name.clone())),
                ("count".to_owned(), Value::Int(self.count)),
                ("active".to_owned(), Value::Bool(self.active)),
            ],
        }
    }

    fn from_value(value: &Value) -> Result<Self, ReflectError> {
        let Value::Record { fields } = value else {
            return Err(ReflectError::TypeMismatch);
        };
        let name = read_string(fields, "name")?;
        let count = read_int(fields, "count")?;
        let active = read_bool(fields, "active")?;
        Ok(Self {
            name,
            count,
            active,
        })
    }
}

/// Read a dynamic string field.
fn read_string(fields: &[(String, Value)], name: &str) -> Result<String, ReflectError> {
    match reflect::field(fields, name)? {
        Value::Str(value) => Ok(value.clone()),
        _ => Err(ReflectError::TypeMismatch),
    }
}

/// Read a dynamic integer field.
fn read_int(fields: &[(String, Value)], name: &str) -> Result<i64, ReflectError> {
    match reflect::field(fields, name)? {
        Value::Int(value) => Ok(*value),
        _ => Err(ReflectError::TypeMismatch),
    }
}

/// Read a dynamic bool field.
fn read_bool(fields: &[(String, Value)], name: &str) -> Result<bool, ReflectError> {
    match reflect::field(fields, name)? {
        Value::Bool(value) => Ok(*value),
        _ => Err(ReflectError::TypeMismatch),
    }
}

/// Dynamic `Value` encode/decode delegates to the typed TDBIN codec.
#[test]
fn reflective_value_codec_round_trips_through_typed_bytes() -> TestResult {
    let value = Value::Record {
        fields: vec![
            ("name".to_owned(), Value::Str("Ada".to_owned())),
            ("count".to_owned(), Value::Int(42)),
            ("active".to_owned(), Value::Bool(true)),
        ],
    };
    let wire = reflect::encode::<Mini>(&value)?;
    reflect::verify::<Mini>(&wire)?;
    assert_eq!(reflect::decode::<Mini>(&wire)?, value);
    assert_eq!(reflect::type_def::<Mini>(), Mini::type_def());
    Ok(())
}

/// Shape errors stay typed and never enter the byte codec.
#[test]
fn reflective_value_codec_rejects_bad_dynamic_shapes() {
    assert_eq!(
        reflect::encode::<Mini>(&Value::Bool(true)),
        Err(ReflectError::TypeMismatch)
    );
    assert_eq!(
        reflect::encode::<Mini>(&Value::Record { fields: Vec::new() }),
        Err(ReflectError::MissingField {
            name: "name".to_owned(),
        })
    );
}
