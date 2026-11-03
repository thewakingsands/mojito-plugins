//! The input is borrowed for one synchronous call. Only this module owns outputs.
use crate::{MAX_PACKAGE, Package};
use std::{panic::catch_unwind, ptr, slice};

#[cfg(panic = "abort")]
compile_error!("the package ffi feature requires panic=unwind");

fn result(bytes: &[u8], limit: u64) -> crate::Result<Vec<u8>> {
  if bytes.len() as u64 > limit {
    return Err("Package exceeds configured size limit".into());
  }
  let package = Package::open(bytes.to_vec())?;
  for file in &package.files {
    package.read(&file.path)?;
  }
  serde_json::to_vec(&package.inspection).map_err(|e| e.to_string())
}

fn error(message: &str) -> Vec<u8> {
  serde_json::to_vec(&serde_json::json!({"error": message})).expect("serialize error string")
}

/// Verify the signature, manifest and every member's length/CRC.
///
/// # Safety
/// Non-null pointers must be valid for their stated sizes. `output` and
/// `output_len` must point to writable, nonoverlapping storage. The input must
/// remain immutable until return. Free the returned buffer exactly once with
/// `mojito_package_free`, even when the status is nonzero.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mojito_package_verify(
  input: *const u8,
  input_len: usize,
  max_package_bytes: u64,
  output: *mut *mut u8,
  output_len: *mut usize,
) -> i32 {
  if output.is_null() || output_len.is_null() {
    return 2;
  }
  unsafe {
    *output = ptr::null_mut();
    *output_len = 0;
  }
  let outcome = catch_unwind(|| {
    if input.is_null()
      || input_len > MAX_PACKAGE
      || max_package_bytes == 0
      || max_package_bytes > MAX_PACKAGE as u64
    {
      return (2, error("Invalid verifier arguments"));
    }
    let bytes = unsafe { slice::from_raw_parts(input, input_len) };
    match result(bytes, max_package_bytes) {
      Ok(json) => (0, json),
      Err(message) => (1, error(&message)),
    }
  });
  let (status, json) = outcome.unwrap_or_else(|_| (3, error("Package verifier panicked")));
  let buffer = json.into_boxed_slice();
  unsafe {
    *output_len = buffer.len();
    *output = Box::into_raw(buffer).cast::<u8>();
  }
  status
}

/// # Safety
/// Pass only the pointer and exact length returned by `mojito_package_verify`,
/// once. A null pointer is accepted.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mojito_package_free(output: *mut u8, output_len: usize) {
  if !output.is_null() {
    unsafe {
      drop(Box::from_raw(ptr::slice_from_raw_parts_mut(
        output, output_len,
      )))
    };
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::{Compression, pack_files};

  fn verify(bytes: &[u8], limit: u64) -> (i32, serde_json::Value) {
    let mut output = ptr::null_mut();
    let mut len = 0;
    unsafe {
      let status = mojito_package_verify(bytes.as_ptr(), bytes.len(), limit, &mut output, &mut len);
      let json = serde_json::from_slice(slice::from_raw_parts(output, len)).unwrap();
      mojito_package_free(output, len);
      (status, json)
    }
  }

  fn package(compression: Compression) -> Vec<u8> {
    let key = ed25519_dalek::SigningKey::from_bytes(&[7; 32]);
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
    let jwk = serde_json::json!({"kty":"OKP","crv":"Ed25519",
      "x":B64.encode(key.verifying_key().as_bytes()),"d":B64.encode(key.to_bytes())});
    pack_files(
      vec![
        ("plugin.json".into(), r#"{"schemaVersion":1,"id":"ffi-test","version":"1.0.0","name":"测试","apiVersion":"*","entry":{"kind":"worker","path":"index.mjs"},"capabilities":{"required":[],"optional":[]},"networkOrigins":[]}"#.as_bytes().to_vec()),
        ("index.mjs".into(), b"export {}".to_vec()),
      ],
      &jwk.to_string(),
      compression,
    ).unwrap()
  }

  #[test]
  fn verifies_members_and_releases_outputs() {
    for compression in [Compression::Copy, Compression::Lzma2] {
      let mut bytes = package(compression);
      for _ in 0..30 {
        let (status, json) = verify(&bytes, MAX_PACKAGE as u64);
        assert_eq!(status, 0);
        assert_eq!(json["signatureValid"], true);
        assert_eq!(json["metadata"]["manifest"]["id"], "ffi-test");
      }
      assert_eq!(verify(&bytes, bytes.len() as u64 - 1).0, 1);
      *bytes.last_mut().unwrap() ^= 1;
      assert_eq!(verify(&bytes, MAX_PACKAGE as u64).0, 1);
    }
  }

  #[test]
  fn rejects_invalid_arguments_and_initializes_outputs() {
    let mut output = ptr::dangling_mut();
    let mut len = 99;
    unsafe {
      assert_eq!(
        mojito_package_verify(ptr::null(), 0, 1, &mut output, ptr::null_mut()),
        2
      );
      assert_eq!(
        mojito_package_verify(ptr::null(), 0, 1, &mut output, &mut len),
        2
      );
      assert!(!output.is_null());
      mojito_package_free(output, len);
      mojito_package_free(ptr::null_mut(), 0);
    }
    assert_eq!(verify(b"invalid", 0).0, 2);
    assert_eq!(verify(b"invalid", MAX_PACKAGE as u64 + 1).0, 2);
    assert_eq!(verify(b"invalid", MAX_PACKAGE as u64).0, 1);
  }
}
