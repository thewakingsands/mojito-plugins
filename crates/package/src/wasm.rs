use crate::*;
use js_sys::{Array, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;

fn error(message: String) -> JsValue {
  js_sys::Error::new(&message).into()
}

#[wasm_bindgen(js_name = privateKeyFromSeed)]
pub fn private_key_from_seed(seed: &[u8]) -> std::result::Result<String, JsValue> {
  private_jwk(seed).map_err(error)
}

#[wasm_bindgen(js_name = validatePrivateKey)]
pub fn validate_key(private_jwk: &str) -> std::result::Result<String, JsValue> {
  serde_json::to_string(&validate_private_key(private_jwk).map_err(error)?)
    .map_err(|e| error(e.to_string()))
}

#[wasm_bindgen(js_name = packFiles)]
pub fn pack(
  files: Array,
  private_jwk: &str,
  compression: &str,
) -> std::result::Result<Vec<u8>, JsValue> {
  ensure(
    files.length() as usize <= MAX_FILES,
    "Too many package entries",
  )
  .map_err(error)?;
  let mut input = Vec::new();
  for file in files.iter() {
    let path = Reflect::get(&file, &"path".into())?
      .as_string()
      .ok_or_else(|| error("Expected a package file path".into()))?;
    let bytes = Reflect::get(&file, &"bytes".into())?
      .dyn_into::<Uint8Array>()
      .map_err(|_| error("Expected Uint8Array file bytes".into()))?;
    input.push((path, bytes.to_vec()));
  }
  pack_files(
    input,
    private_jwk,
    Compression::parse(compression).map_err(error)?,
  )
  .map_err(error)
}

#[wasm_bindgen(js_name = verifyPackage)]
pub fn verify_all(bytes: &[u8]) -> std::result::Result<String, JsValue> {
  let verification = verify_package(bytes.to_vec()).map_err(error)?;
  serde_json::to_string(&verification).map_err(|e| error(e.to_string()))
}
