use plugin_protocol::{MAX_BYTES, Value, decode, encode, encode_frame, read_frame};
use std::{collections::BTreeMap, io::Cursor};
fn bytes(hex: &str) -> Vec<u8> {
  (0..hex.len())
    .step_by(2)
    .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
    .collect()
}
fn expected(v: &serde_json::Value) -> Value {
  match v["type"].as_str().unwrap() {
    "null" => Value::Null,
    "boolean" => Value::Bool(v["value"].as_bool().unwrap()),
    "number" => Value::Number(v["value"].as_f64().unwrap()),
    "bigint" => Value::BigInt(v["value"].as_str().unwrap().parse().unwrap()),
    "string" => Value::String(v["value"].as_str().unwrap().into()),
    "binary" => Value::Binary(
      v["value"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_u64().unwrap() as u8)
        .collect(),
    ),
    "array" => Value::Array(
      v["value"]
        .as_array()
        .unwrap()
        .iter()
        .map(expected)
        .collect(),
    ),
    "map" => Value::Map(
      v["value"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), expected(v)))
        .collect(),
    ),
    _ => panic!("unknown fixture"),
  }
}
#[test]
fn shared_vectors() {
  let cases: serde_json::Value =
    serde_json::from_str(include_str!("../fixtures/values.json")).unwrap();
  for case in cases.as_array().unwrap() {
    let value = expected(case);
    let wire = bytes(case["hex"].as_str().unwrap());
    assert_eq!(encode(&value).unwrap(), wire, "{}", case["name"]);
    assert_eq!(decode(&wire).unwrap(), value, "{}", case["name"]);
  }
}
#[test]
fn reject_invalid_input() {
  for hex in [
    "c7ffffff",
    "d4ff00",
    "810100",
    "ddffffffff",
    "dbffffffff",
    "c600400000",
    "c1",
    "01c0",
    "cb7ff0000000000000",
    "a1ff",
  ] {
    assert!(decode(&bytes(hex)).is_err(), "{hex}");
  }
  assert!(encode(&Value::Number(f64::NAN)).is_err());
  assert!(encode(&Value::BigInt(u64::MAX as i128 + 1)).is_err());
  assert!(encode(&Value::BigInt(i64::MIN as i128 - 1)).is_err());
  assert!(encode(&Value::Array(vec![Value::Null; 65537])).is_err());
  assert!(encode(&Value::Binary(vec![0; MAX_BYTES])).is_err());
  let mut nested = vec![0x91; 32];
  nested.push(0xc0);
  assert!(decode(&nested).is_ok());
  nested.insert(0, 0x91);
  assert!(decode(&nested).is_err());
}
#[test]
fn frames_and_named_bin() {
  let value = Value::Map(BTreeMap::from([("__proto__".into(), Value::BigInt(1))]));
  assert_eq!(decode(&encode(&value).unwrap()).unwrap(), value);
  let frame = encode_frame(&value).unwrap();
  assert_eq!(read_frame(&mut Cursor::new(&frame)).unwrap(), value);
  assert!(read_frame(&mut Cursor::new(&frame[..frame.len() - 1])).is_err());
  assert!(read_frame(&mut Cursor::new([0, 0, 0, 0])).is_err());
  assert!(read_frame(&mut Cursor::new(((MAX_BYTES + 1) as u32).to_le_bytes())).is_err());
  let bin = BTreeMap::from([("data", serde_bytes::Bytes::new(&[0, 255]))]);
  assert_eq!(
    rmp_serde::to_vec_named(&bin).unwrap(),
    bytes("81a464617461c40200ff")
  );
}
#[test]
fn envelopes() {
  use plugin_protocol::message::{Envelope, KINDS};
  for kind in KINDS {
    let fields = BTreeMap::from([
      ("protocol".into(), Value::Number(1.0)),
      ("activationId".into(), Value::String("synthetic".into())),
      ("kind".into(), Value::String((*kind).into())),
      ("payload".into(), Value::BigInt(1)),
    ]);
    let bytes = encode(&Value::Map(fields.clone())).unwrap();
    let message = Envelope::decode(&bytes, "synthetic").unwrap();
    assert_eq!(message.kind(), *kind);
    assert_eq!(message.encode().unwrap(), bytes);
    assert!(Envelope::decode(&bytes, "old").is_err());
    for (key, value) in [
      ("protocol", Value::Number(2.0)),
      ("kind", Value::String("invoke-any-ipc".into())),
    ] {
      let mut invalid = fields.clone();
      invalid.insert(key.into(), value);
      assert!(Envelope::decode(&encode(&Value::Map(invalid)).unwrap(), "synthetic").is_err());
    }
  }
}
