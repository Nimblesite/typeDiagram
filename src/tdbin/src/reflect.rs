//! Optional reflective tooling bridge ([TDBIN-RS-REFLECT]).
//!
//! This module deliberately stays off the serialization hot path. The core
//! `Struct`/`TdBin` implementation still encodes typed values directly. Tooling
//! that wants a dynamic tree can opt into [`ValueCodec`]: generated or manual
//! types describe their [`TypeDef`] and convert to/from [`Value`], while the
//! final bytes still flow through the typed codec.

use core::fmt;

use crate::{DecodeError, EncodeError, TdBin};

/// A reflected type definition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeDef {
    /// A record definition with named fields.
    Record {
        /// Type name.
        name: String,
        /// Record fields in declaration order.
        fields: Vec<FieldDef>,
    },
    /// A tagged union definition with named variants.
    Union {
        /// Type name.
        name: String,
        /// Union variants in ordinal order.
        variants: Vec<VariantDef>,
    },
    /// An alias definition.
    Alias {
        /// Alias name.
        name: String,
        /// Alias target.
        target: TypeRef,
    },
}

/// A reflected record field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldDef {
    /// Field name.
    pub name: String,
    /// Field type.
    pub ty: TypeRef,
}

/// A reflected union variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantDef {
    /// Variant name.
    pub name: String,
    /// Tuple/named payload fields. Empty means a bare variant.
    pub fields: Vec<FieldDef>,
    /// Optional pinned source-level ordinal for tooling.
    pub pinned: Option<i64>,
}

/// A reflected type reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeRef {
    /// Boolean scalar.
    Bool,
    /// Signed 64-bit integer scalar.
    Int,
    /// IEEE-754 double scalar.
    Float,
    /// UTF-8 string scalar.
    Str,
    /// Raw byte-list scalar.
    Bytes,
    /// Microsecond UTC timestamp scalar.
    DateTime,
    /// 16-byte UUID scalar.
    Uuid,
    /// 16-byte decimal scalar.
    Decimal,
    /// Optional value.
    Option(Box<TypeRef>),
    /// List value.
    List(Box<TypeRef>),
    /// Named record/union/alias reference.
    Named(String),
    /// Generic parameter reference for tooling metadata.
    Param(String),
}

/// A dynamic value tree used by tooling.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// Unit value.
    Unit,
    /// Boolean scalar.
    Bool(bool),
    /// Signed integer scalar.
    Int(i64),
    /// Floating-point scalar.
    Float(f64),
    /// UTF-8 string scalar.
    Str(String),
    /// Raw bytes scalar.
    Bytes(Vec<u8>),
    /// Microsecond UTC timestamp scalar.
    DateTime(i64),
    /// 16-byte UUID scalar.
    Uuid([u8; 16]),
    /// 16-byte decimal scalar.
    Decimal([u8; 16]),
    /// Optional value.
    Option(Option<Box<Value>>),
    /// List value.
    List(Vec<Value>),
    /// Record value with fields in any tooling order.
    Record {
        /// Named field values.
        fields: Vec<(String, Value)>,
    },
    /// Union value.
    Union {
        /// Variant name.
        variant: String,
        /// Optional payload value.
        value: Option<Box<Value>>,
    },
}

/// Errors returned by the reflective tooling bridge.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReflectError {
    /// Dynamic value shape did not match the reflected type.
    TypeMismatch,
    /// A required field was absent from a dynamic record value.
    MissingField {
        /// Missing field name.
        name: String,
    },
    /// A dynamic record value contained an unknown field.
    UnknownField {
        /// Unknown field name.
        name: String,
    },
    /// A dynamic union value named an unknown variant.
    UnknownVariant {
        /// Unknown variant name.
        name: String,
    },
    /// Typed encoding failed.
    Encode(EncodeError),
    /// Typed decoding failed.
    Decode(DecodeError),
}

impl fmt::Display for ReflectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TypeMismatch => f.write_str("dynamic value does not match the reflected type"),
            Self::MissingField { name } => write!(f, "dynamic record is missing field {name}"),
            Self::UnknownField { name } => {
                write!(f, "dynamic record contains unknown field {name}")
            }
            Self::UnknownVariant { name } => {
                write!(f, "dynamic union contains unknown variant {name}")
            }
            Self::Encode(err) => write!(f, "typed encode failed: {err}"),
            Self::Decode(err) => write!(f, "typed decode failed: {err}"),
        }
    }
}

impl std::error::Error for ReflectError {}

impl From<EncodeError> for ReflectError {
    fn from(value: EncodeError) -> Self {
        Self::Encode(value)
    }
}

impl From<DecodeError> for ReflectError {
    fn from(value: DecodeError) -> Self {
        Self::Decode(value)
    }
}

/// Tooling bridge from a typed TDBIN value to a dynamic [`Value`] tree.
pub trait ValueCodec: TdBin {
    /// Return the reflected type definition for this generated/manual type.
    fn type_def() -> TypeDef;

    /// Convert a typed value into a dynamic value tree.
    fn to_value(&self) -> Value;

    /// Convert a dynamic value tree into a typed value.
    ///
    /// # Errors
    /// Returns [`ReflectError`] when the dynamic value shape does not match.
    fn from_value(value: &Value) -> Result<Self, ReflectError>;
}

/// Encode a dynamic value through the typed codec for `T`.
///
/// # Errors
/// Returns [`ReflectError`] when value conversion or typed encoding fails.
pub fn encode<T: ValueCodec>(value: &Value) -> Result<Vec<u8>, ReflectError> {
    T::from_value(value)?.to_bytes().map_err(ReflectError::from)
}

/// Decode bytes through the typed codec for `T`, then materialize a dynamic tree.
///
/// # Errors
/// Returns [`ReflectError`] when typed decoding fails.
pub fn decode<T: ValueCodec>(wire: &[u8]) -> Result<Value, ReflectError> {
    T::from_bytes(wire)
        .map(|value| value.to_value())
        .map_err(ReflectError::from)
}

/// Verify bytes by decoding through the typed codec for `T`.
///
/// # Errors
/// Returns [`ReflectError`] when typed decoding fails.
pub fn verify<T: ValueCodec>(wire: &[u8]) -> Result<(), ReflectError> {
    T::from_bytes(wire).map(|_| ()).map_err(ReflectError::from)
}

/// Return the reflected type definition for `T`.
#[must_use]
pub fn type_def<T: ValueCodec>() -> TypeDef {
    T::type_def()
}

/// Return a field value by name, rejecting missing or duplicate fields.
///
/// # Errors
/// Returns [`ReflectError`] if the field is absent or duplicated.
pub fn field<'a>(fields: &'a [(String, Value)], name: &str) -> Result<&'a Value, ReflectError> {
    let mut found = fields.iter().filter(|(field, _)| field == name);
    let value = found
        .next()
        .map(|(_, value)| value)
        .ok_or_else(|| ReflectError::MissingField {
            name: name.to_owned(),
        })?;
    if found.next().is_some() {
        Err(ReflectError::UnknownField {
            name: name.to_owned(),
        })
    } else {
        Ok(value)
    }
}
