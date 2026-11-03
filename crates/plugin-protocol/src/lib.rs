//! Bounded MessagePack Value codec. Integer marker width preserves JS number/bigint.
use rmp::Marker;
use std::{
  collections::BTreeMap,
  fmt::Debug,
  io::{Cursor, Read, Write},
};

pub mod abi;
pub mod message;
pub const MAX_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_DEPTH: usize = 32;
pub const MAX_ITEMS: usize = 65536;
pub type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
  Null,
  Bool(bool),
  Number(f64),
  BigInt(i128),
  String(String),
  Binary(Vec<u8>),
  Array(Vec<Value>),
  Map(BTreeMap<String, Value>),
}
fn checked<T, E: Debug>(result: std::result::Result<T, E>) -> Result<T> {
  result.map_err(|error| format!("{error:?}"))
}
struct BoundedWriter(Vec<u8>);
impl Write for BoundedWriter {
  fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
    if bytes.len() > MAX_BYTES - self.0.len() {
      return Err(std::io::Error::other("message exceeds byte limit"));
    }
    self.0.extend_from_slice(bytes);
    Ok(bytes.len())
  }
  fn flush(&mut self) -> std::io::Result<()> {
    Ok(())
  }
}
pub fn encode(value: &Value) -> Result<Vec<u8>> {
  let mut output = BoundedWriter(Vec::new());
  write_value(&mut output, value, 0)?;
  Ok(output.0)
}
fn write_value(output: &mut BoundedWriter, value: &Value, depth: usize) -> Result<()> {
  use rmp::encode as e;
  if depth > MAX_DEPTH {
    return Err("value exceeds depth limit".into());
  }
  match value {
    Value::Null => checked(e::write_nil(output))?,
    Value::Bool(v) => checked(e::write_bool(output, *v))?,
    Value::Number(v) => {
      if !v.is_finite() {
        return Err("non-finite number".into());
      }
      if v.fract() == 0.0 && *v >= -2147483648.0 && *v <= 4294967295.0 {
        if *v >= 0.0 {
          checked(e::write_uint(output, *v as u64))?;
        } else {
          checked(e::write_sint(output, *v as i64))?;
        }
      } else {
        checked(e::write_f64(output, *v))?;
      }
    }
    Value::BigInt(v) => {
      if *v < i64::MIN as i128 || *v > u64::MAX as i128 {
        return Err("bigint outside protocol range".into());
      }
      if *v < 0 {
        checked(e::write_i64(output, *v as i64))?;
      } else {
        checked(e::write_u64(output, *v as u64))?;
      }
    }
    Value::String(v) => {
      if v.len() > MAX_BYTES {
        return Err("string too large".into());
      }
      checked(e::write_str(output, v))?;
    }
    Value::Binary(v) => {
      if v.len() > MAX_BYTES {
        return Err("binary too large".into());
      }
      checked(e::write_bin(output, v))?;
    }
    Value::Array(v) => {
      if v.len() > MAX_ITEMS {
        return Err("array too large".into());
      }
      checked(e::write_array_len(output, v.len() as u32))?;
      for item in v {
        write_value(output, item, depth + 1)?;
      }
    }
    Value::Map(v) => {
      if v.len() > MAX_ITEMS {
        return Err("map too large".into());
      }
      checked(e::write_map_len(output, v.len() as u32))?;
      for (key, item) in v {
        if key.len() > MAX_BYTES {
          return Err("key too large".into());
        }
        checked(e::write_str(output, key))?;
        write_value(output, item, depth + 1)?;
      }
    }
  }
  Ok(())
}
pub fn decode(bytes: &[u8]) -> Result<Value> {
  if bytes.is_empty() || bytes.len() > MAX_BYTES {
    return Err("invalid message length".into());
  }
  let mut input = Cursor::new(bytes);
  let result = read_value(&mut input, 0)?;
  if input.position() as usize != bytes.len() {
    return Err("trailing MessagePack data".into());
  }
  Ok(result)
}
fn remaining(input: &Cursor<&[u8]>) -> usize {
  input.get_ref().len() - input.position() as usize
}
fn read_bytes(input: &mut Cursor<&[u8]>, len: usize) -> Result<Vec<u8>> {
  if len > remaining(input) {
    return Err("truncated bytes".into());
  }
  let mut result = vec![0; len];
  checked(input.read_exact(&mut result))?;
  Ok(result)
}
fn read_value(input: &mut Cursor<&[u8]>, depth: usize) -> Result<Value> {
  use rmp::decode as d;
  if depth > MAX_DEPTH {
    return Err("message exceeds depth limit".into());
  }
  let position = input.position();
  let marker = checked(d::read_marker(input))?;
  input.set_position(position);
  Ok(match marker {
    Marker::Null => {
      checked(d::read_nil(input))?;
      Value::Null
    }
    Marker::True | Marker::False => Value::Bool(checked(d::read_bool(input))?),
    Marker::U64 => Value::BigInt(checked(d::read_u64(input))? as i128),
    Marker::I64 => Value::BigInt(checked(d::read_i64(input))? as i128),
    Marker::FixPos(_)
    | Marker::FixNeg(_)
    | Marker::U8
    | Marker::U16
    | Marker::U32
    | Marker::I8
    | Marker::I16
    | Marker::I32 => Value::Number(checked(d::read_int::<i64, _>(input))? as f64),
    Marker::F32 | Marker::F64 => {
      let value = if marker == Marker::F32 {
        checked(d::read_f32(input))? as f64
      } else {
        checked(d::read_f64(input))?
      };
      if !value.is_finite() {
        return Err("non-finite number".into());
      }
      Value::Number(value)
    }
    Marker::FixStr(_) | Marker::Str8 | Marker::Str16 | Marker::Str32 => {
      let length = checked(d::read_str_len(input))? as usize;
      Value::String(checked(String::from_utf8(read_bytes(input, length)?))?)
    }
    Marker::Bin8 | Marker::Bin16 | Marker::Bin32 => {
      let length = checked(d::read_bin_len(input))? as usize;
      Value::Binary(read_bytes(input, length)?)
    }
    Marker::FixArray(_) | Marker::Array16 | Marker::Array32 => {
      let length = checked(d::read_array_len(input))? as usize;
      if length > MAX_ITEMS || length > remaining(input) {
        return Err("invalid array length".into());
      }
      let mut items = Vec::new();
      for _ in 0..length {
        items.push(read_value(input, depth + 1)?);
      }
      Value::Array(items)
    }
    Marker::FixMap(_) | Marker::Map16 | Marker::Map32 => {
      let length = checked(d::read_map_len(input))? as usize;
      if length > MAX_ITEMS || length * 2 > remaining(input) {
        return Err("invalid map length".into());
      }
      let mut items = BTreeMap::new();
      for _ in 0..length {
        let Value::String(key) = read_value(input, depth + 1)? else {
          return Err("map keys must be strings".into());
        };
        let value = read_value(input, depth + 1)?;
        items.insert(key, value);
      }
      Value::Map(items)
    }
    _ => return Err("unsupported MessagePack marker or extension".into()),
  })
}

pub fn encode_frame(value: &Value) -> Result<Vec<u8>> {
  let payload = encode(value)?;
  let mut result = Vec::with_capacity(payload.len() + 4);
  result.extend_from_slice(&(payload.len() as u32).to_le_bytes());
  result.extend(payload);
  Ok(result)
}
/// Read one exact frame; EOF/truncation are failures. Callers close the pipe on error.
pub fn read_frame(input: &mut impl Read) -> Result<Value> {
  let mut header = [0; 4];
  checked(input.read_exact(&mut header))?;
  let length = u32::from_le_bytes(header) as usize;
  if length == 0 || length > MAX_BYTES {
    return Err("invalid frame length".into());
  }
  let mut payload = vec![0; length];
  checked(input.read_exact(&mut payload))?;
  decode(&payload)
}
