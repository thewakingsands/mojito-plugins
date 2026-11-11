use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use ed25519_dalek::{Signature, VerifyingKey};
#[cfg(feature = "codec")]
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub type Result<T> = std::result::Result<T, String>;
pub const MAGIC: &[u8; 8] = b"MJPKG01\0";
pub const MAX_PACKAGE: usize = 256 * 1024 * 1024;
#[cfg(feature = "ffi")]
mod ffi;
const MAX_JWS: usize = 128 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
  pub format_version: u8,
  pub manifest: Value,
  pub archive_sha256: String,
  pub archive_size: usize,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Compression {
  Copy,
  Lzma2,
}
impl Compression {
  pub fn parse(value: &str) -> Result<Self> {
    match value {
      "copy" => Ok(Self::Copy),
      "lzma2" => Ok(Self::Lzma2),
      _ => Err("Compression must be copy or lzma2".into()),
    }
  }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageSigner {
  pub public_key: String,
  pub fingerprint: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
  pub metadata: Metadata,
  pub signer: PackageSigner,
  pub signature_valid: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PublicJwk {
  kty: String,
  crv: String,
  x: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Header {
  alg: String,
  typ: String,
  jwk: PublicJwk,
}

pub fn hash(bytes: &[u8]) -> String {
  Sha256::digest(bytes)
    .iter()
    .map(|x| format!("{x:02x}"))
    .collect()
}
fn ensure(condition: bool, message: &str) -> Result<()> {
  if condition {
    Ok(())
  } else {
    Err(message.into())
  }
}
fn decode(value: &str) -> Result<Vec<u8>> {
  let bytes = B64.decode(value).map_err(|_| "Invalid base64url")?;
  ensure(B64.encode(&bytes) == value, "Noncanonical base64url")?;
  Ok(bytes)
}

// Reject duplicate keys at every depth before serde can discard an earlier value.
struct Unique(Value);
impl<'de> Deserialize<'de> for Unique {
  fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
    struct Visitor;
    impl<'de> serde::de::Visitor<'de> for Visitor {
      type Value = Unique;
      fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("JSON without duplicate keys")
      }
      fn visit_bool<E: serde::de::Error>(self, v: bool) -> std::result::Result<Unique, E> {
        Ok(Unique(v.into()))
      }
      fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Unique, E> {
        Ok(Unique(v.into()))
      }
      fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Unique, E> {
        Ok(Unique(v.into()))
      }
      fn visit_f64<E: serde::de::Error>(self, v: f64) -> std::result::Result<Unique, E> {
        serde_json::Number::from_f64(v)
          .map(|n| Unique(Value::Number(n)))
          .ok_or_else(|| E::custom("Invalid number"))
      }
      fn visit_str<E: serde::de::Error>(self, v: &str) -> std::result::Result<Unique, E> {
        Ok(Unique(v.into()))
      }
      fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Unique, E> {
        Ok(Unique(Value::Null))
      }
      fn visit_seq<A: serde::de::SeqAccess<'de>>(
        self,
        mut a: A,
      ) -> std::result::Result<Unique, A::Error> {
        let mut values = Vec::new();
        while let Some(Unique(v)) = a.next_element()? {
          values.push(v);
        }
        Ok(Unique(Value::Array(values)))
      }
      fn visit_map<A: serde::de::MapAccess<'de>>(
        self,
        mut a: A,
      ) -> std::result::Result<Unique, A::Error> {
        let mut values = serde_json::Map::new();
        while let Some((key, Unique(value))) = a.next_entry::<String, Unique>()? {
          if values.insert(key, value).is_some() {
            return Err(serde::de::Error::custom("Duplicate JSON field"));
          }
        }
        Ok(Unique(Value::Object(values)))
      }
    }
    d.deserialize_any(Visitor)
  }
}
pub fn json(bytes: &[u8]) -> Result<Value> {
  ensure(bytes.len() <= MAX_JWS, "JSON too large")?;
  let value = serde_json::from_slice::<Unique>(bytes)
    .map_err(|e| e.to_string())?
    .0;
  fn depth(v: &Value, n: usize) -> bool {
    n <= 32
      && match v {
        Value::Array(a) => a.iter().all(|v| depth(v, n + 1)),
        Value::Object(o) => o.values().all(|v| depth(v, n + 1)),
        _ => true,
      }
  }
  ensure(depth(&value, 0), "JSON too deep")?;
  Ok(value)
}
pub fn resource_path(name: &str) -> Result<()> {
  ensure(
    !name.is_empty()
      && name.encode_utf16().count() <= 240
      && !name
        .chars()
        .any(|c| c <= '\u{1f}' || "\\:<>\"|?*".contains(c)),
    "Invalid package path",
  )?;
  for part in name.split('/') {
    ensure(
      !part.is_empty() && part != "." && part != ".." && !part.ends_with(['.', ' ']),
      "Invalid package segment",
    )?;
  }
  Ok(())
}
fn manifest_entry(manifest: &Value) -> Result<&str> {
  let path = manifest["entry"]["path"]
    .as_str()
    .ok_or("Missing manifest entry")?;
  resource_path(path)?;
  Ok(path)
}
pub fn verify(bytes: &[u8]) -> Result<(Inspection, usize)> {
  ensure(
    bytes.len() <= MAX_PACKAGE && bytes.len() >= 12 && &bytes[..8] == MAGIC,
    "Invalid package magic or size",
  )?;
  let length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
  ensure(
    length > 0 && length <= MAX_JWS && length <= bytes.len() - 12,
    "Invalid signature length",
  )?;
  let offset = 12 + length;
  let jws = std::str::from_utf8(&bytes[12..offset]).map_err(|_| "Invalid JWS encoding")?;
  let parts: Vec<_> = jws.split('.').collect();
  ensure(parts.len() == 3, "Invalid compact JWS")?;
  let header: Header =
    serde_json::from_value(json(&decode(parts[0])?)?).map_err(|e| e.to_string())?;
  ensure(
    header.alg == "EdDSA"
      && header.typ == "mojito-package+jws"
      && header.jwk.kty == "OKP"
      && header.jwk.crv == "Ed25519",
    "Unsupported JWS header",
  )?;
  let public = decode(&header.jwk.x)?;
  let key = VerifyingKey::from_bytes(
    public
      .as_slice()
      .try_into()
      .map_err(|_| "Invalid public key")?,
  )
  .map_err(|e| e.to_string())?;
  let signature = Signature::from_slice(&decode(parts[2])?).map_err(|e| e.to_string())?;
  key
    .verify_strict(
      &jws.as_bytes()[..parts[0].len() + 1 + parts[1].len()],
      &signature,
    )
    .map_err(|_| "Signature verification failed")?;
  let metadata: Metadata =
    serde_json::from_value(json(&decode(parts[1])?)?).map_err(|e| e.to_string())?;
  manifest_entry(&metadata.manifest)?;
  ensure(metadata.format_version == 1, "Unsupported package metadata")?;
  let archive = &bytes[offset..];
  ensure(
    archive.starts_with(b"7z\xbc\xaf\x27\x1c")
      && metadata.archive_size == archive.len()
      && metadata.archive_sha256 == hash(archive),
    "Archive digest or size mismatch",
  )?;
  Ok((
    Inspection {
      metadata,
      signer: PackageSigner {
        public_key: header.jwk.x,
        fingerprint: hash(&public),
      },
      signature_valid: true,
    },
    offset,
  ))
}
pub fn inspect(bytes: &[u8]) -> Result<String> {
  serde_json::to_string(&verify(bytes)?.0).map_err(|e| e.to_string())
}

#[cfg(feature = "codec")]
mod codec;
#[cfg(feature = "codec")]
pub use codec::{Package, pack_directory, pack_files};
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(js_name = inspectPackage)]
pub fn inspect_web(bytes: &[u8]) -> std::result::Result<String, wasm_bindgen::JsValue> {
  inspect(bytes).map_err(|e| wasm_bindgen::JsValue::from_str(&e))
}
