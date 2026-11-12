use crate::*;
use sevenz_rust2::{ArchiveEntry, ArchiveReader, ArchiveWriter, EncoderMethod, Password};
use std::{collections::BTreeMap, fs, io::Cursor, path::Path, sync::Arc};

#[derive(Clone, Debug, Serialize)]
pub struct FileInfo {
  pub path: String,
  pub size: u64,
}
#[derive(Clone)]
pub struct Package {
  bytes: Arc<Vec<u8>>,
  offset: usize,
  archive: Arc<sevenz_rust2::Archive>,
  pub inspection: Inspection,
  pub files: Vec<FileInfo>,
}
impl Package {
  pub fn open(bytes: Vec<u8>) -> Result<Self> {
    let (inspection, offset) = verify(&bytes)?;
    let mut reader = ArchiveReader::new(Cursor::new(&bytes[offset..]), Password::empty())
      .map_err(|e| e.to_string())?;
    let archive = reader.archive();
    ensure(!archive.is_solid, "Solid archives are not supported")?;
    for block in &archive.blocks {
      ensure(block.coders.len() == 1, "Invalid compression block")?;
      let coder = &block.coders[0];
      ensure(
        coder.encoder_method_id() == EncoderMethod::COPY.id()
          || coder.encoder_method_id() == EncoderMethod::LZMA2.id(),
        "Unsupported compression method",
      )?;
      if coder.encoder_method_id() == EncoderMethod::LZMA2.id() {
        // The writer uses the standard 8 MiB dictionary. Reject oversized decoder allocations.
        ensure(
          coder.properties().len() == 1 && coder.properties()[0] <= 22,
          "LZMA2 dictionary too large",
        )?;
      }
    }
    let mut names: BTreeMap<String, (String, bool, bool)> = BTreeMap::new();
    let mut files = Vec::new();
    for entry in &archive.files {
      resource_path(&entry.name)?;
      ensure(
        !entry.is_anti_item && (!entry.is_directory || entry.size == 0),
        "Invalid 7z entry",
      )?;
      let mode = entry.windows_attributes >> 16;
      ensure(
        !entry.has_windows_attributes
          || (entry.windows_attributes & 0x400 == 0
            && (mode & 0xf000 == 0
              || mode & 0xf000 == if entry.is_directory { 0x4000 } else { 0x8000 })),
        "Links and special files forbidden",
      )?;
      let parts: Vec<_> = entry.name.split('/').collect();
      for i in 1..=parts.len() {
        let original = parts[..i].join("/");
        let key = original.to_lowercase();
        let directory = i < parts.len() || entry.is_directory;
        let explicit = i == parts.len();
        if let Some((old, old_dir, old_explicit)) = names.get(&key) {
          ensure(
            old == &original && *old_dir && directory && !(*old_explicit && explicit),
            "Duplicate or conflicting package path",
          )?;
        }
        let was_explicit = names.get(&key).is_some_and(|x| x.2);
        names.insert(key, (original, directory, explicit || was_explicit));
      }
      if !entry.is_directory {
        files.push(FileInfo {
          path: entry.name.clone(),
          size: entry.size,
        });
      }
    }
    let entry = manifest_entry(&inspection.metadata.manifest)?;
    ensure(
      files.iter().any(|f| f.path == entry),
      "Entry missing from package",
    )?;
    let parsed_archive = Arc::new(reader.archive().clone());
    let manifest = reader.read_file("plugin.json").map_err(|e| e.to_string())?;
    ensure(
      json(&manifest)? == inspection.metadata.manifest,
      "Manifest differs from signed metadata",
    )?;
    Ok(Self {
      bytes: Arc::new(bytes),
      offset,
      archive: parsed_archive,
      inspection,
      files,
    })
  }
  pub fn read(&self, path: &str) -> Result<Vec<u8>> {
    resource_path(path)?;
    let file = self
      .files
      .iter()
      .find(|f| f.path == path)
      .ok_or("Package entry not found")?;
    let mut reader = ArchiveReader::from_archive(
      (*self.archive).clone(),
      Cursor::new(&self.bytes[self.offset..]),
      Password::empty(),
    );
    let bytes = reader.read_file(path).map_err(|e| e.to_string())?;
    ensure(bytes.len() as u64 == file.size, "7z size mismatch")?;
    Ok(bytes)
  }
}

pub fn pack_files(
  files: Vec<(String, Vec<u8>)>,
  private_jwk: &str,
  compression: Compression,
) -> Result<Vec<u8>> {
  let jwk = json(private_jwk.as_bytes())?;
  ensure(
    jwk["kty"] == "OKP" && jwk["crv"] == "Ed25519",
    "Expected Ed25519 private JWK",
  )?;
  let seed = decode(jwk["d"].as_str().ok_or("Missing private key")?)?;
  let key = SigningKey::from_bytes(
    seed
      .as_slice()
      .try_into()
      .map_err(|_| "Invalid private key")?,
  );
  let public_key = B64.encode(key.verifying_key().as_bytes());
  ensure(jwk["x"] == public_key, "Private and public JWK differ")?;
  let mut writer = ArchiveWriter::new(Cursor::new(Vec::new())).map_err(|e| e.to_string())?;
  writer.set_content_methods(vec![
    match compression {
      Compression::Copy => EncoderMethod::COPY,
      Compression::Lzma2 => EncoderMethod::LZMA2,
    }
    .into(),
  ]);
  let mut files = files;
  files.sort_by(|a, b| a.0.cmp(&b.0));
  let mut manifest = None;
  for (name, bytes) in files {
    resource_path(&name)?;
    if name == "plugin.json" {
      manifest = Some(json(&bytes)?);
    }
    writer
      .push_archive_entry(ArchiveEntry::new_file(&name), Some(Cursor::new(bytes)))
      .map_err(|e| e.to_string())?;
  }
  let archive = writer.finish().map_err(|e| e.to_string())?.into_inner();
  let manifest = manifest.ok_or("Missing plugin.json")?;
  manifest_entry(&manifest)?;
  let metadata = Metadata {
    format_version: 1,
    manifest,
    archive_sha256: hash(&archive),
    archive_size: archive.len(),
  };
  let header = Header {
    alg: "EdDSA".into(),
    typ: "mojito-package+jws".into(),
    jwk: PublicJwk {
      kty: "OKP".into(),
      crv: "Ed25519".into(),
      x: public_key,
    },
  };
  let input = format!(
    "{}.{}",
    B64.encode(serde_json::to_vec(&header).map_err(|e| e.to_string())?),
    B64.encode(serde_json::to_vec(&metadata).map_err(|e| e.to_string())?)
  );
  let jws = format!(
    "{}.{}",
    input,
    B64.encode(key.sign(input.as_bytes()).to_bytes())
  );
  ensure(jws.len() <= MAX_JWS, "Metadata too large")?;
  let mut result = MAGIC.to_vec();
  result.extend_from_slice(&(jws.len() as u32).to_le_bytes());
  result.extend_from_slice(jws.as_bytes());
  result.extend_from_slice(&archive);
  let package = Package::open(result.clone())?;
  for file in &package.files {
    package.read(&file.path)?;
  }
  Ok(result)
}
pub fn pack_directory(
  directory: &Path,
  key_path: &Path,
  compression: Compression,
) -> Result<Vec<u8>> {
  let root = fs::canonicalize(directory).map_err(|e| e.to_string())?;
  let key_path = fs::canonicalize(key_path).map_err(|e| e.to_string())?;
  ensure(
    !key_path.starts_with(&root),
    "Keep the signing key outside the input directory",
  )?;
  fn collect(
    root: &Path,
    dir: &Path,
    files: &mut Vec<(String, Vec<u8>)>,
    depth: usize,
  ) -> Result<()> {
    ensure(depth <= 32, "Directory too deep")?;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
      let entry = entry.map_err(|e| e.to_string())?;
      let kind = entry.file_type().map_err(|e| e.to_string())?;
      ensure(!kind.is_symlink(), "Package symlinks forbidden")?;
      if kind.is_dir() {
        collect(root, &entry.path(), files, depth + 1)?;
      } else {
        ensure(kind.is_file(), "Special file")?;
        let size = entry.metadata().map_err(|e| e.to_string())?.len();
        let path = entry.path();
        let relative = path
          .strip_prefix(root)
          .map_err(|e| e.to_string())?
          .to_str()
          .ok_or("Path is not UTF-8")?
          .replace('\\', "/");
        resource_path(&relative)?;
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        ensure(
          bytes.len() as u64 == size
            && !fs::symlink_metadata(&path)
              .map_err(|e| e.to_string())?
              .file_type()
              .is_symlink(),
          "Input changed while packing",
        )?;
        files.push((relative, bytes));
      }
    }
    Ok(())
  }
  let mut files = Vec::new();
  collect(&root, &root, &mut files, 0)?;
  let key = fs::read_to_string(key_path).map_err(|e| e.to_string())?;
  pack_files(files, &key, compression)
}

// Bound the only encoded-header layout emitted by our writer before asking the 7z decoder to allocate.
#[cfg(test)]
mod tests {
  use super::*;
  fn key() -> String {
    let key = SigningKey::from_bytes(&[7; 32]);
    serde_json::json!({"kty":"OKP","crv":"Ed25519","x":B64.encode(key.verifying_key().as_bytes()),"d":B64.encode([7;32])}).to_string()
  }
  fn files() -> Vec<(String, Vec<u8>)> {
    let manifest = serde_json::json!({"schemaVersion":1,"id":"Example.Plugin","name":"Example","version":"1.0.0","apiVersion":"^1.0.0","entry":{"kind":"worker","path":"backend/main.mjs"},"capabilities":{"required":[],"optional":[]},"networkOrigins":[]});
    vec![
      ("plugin.json".into(), manifest.to_string().into_bytes()),
      ("backend/main.mjs".into(), b"import './lazy.mjs'".to_vec()),
      ("backend/lazy.mjs".into(), b"export default 42".to_vec()),
      ("empty".into(), vec![]),
    ]
  }
  fn resign(bytes: &[u8], header: Value, metadata: Value) -> Vec<u8> {
    let (_, offset) = verify(bytes).unwrap();
    let key = SigningKey::from_bytes(&[7; 32]);
    let input = format!(
      "{}.{}",
      B64.encode(header.to_string()),
      B64.encode(metadata.to_string())
    );
    let jws = format!(
      "{}.{}",
      input,
      B64.encode(key.sign(input.as_bytes()).to_bytes())
    );
    let mut result = MAGIC.to_vec();
    result.extend_from_slice(&(jws.len() as u32).to_le_bytes());
    result.extend_from_slice(jws.as_bytes());
    result.extend_from_slice(&bytes[offset..]);
    result
  }
  #[test]
  fn signed_manifest_and_metadata_must_match_archive() {
    let bytes = pack_files(files(), &key(), Compression::Copy).unwrap();
    let metadata = serde_json::to_value(verify(&bytes).unwrap().0.metadata).unwrap();
    let header = serde_json::json!({"alg":"EdDSA","typ":"mojito-package+jws","jwk":{"kty":"OKP","crv":"Ed25519","x":serde_json::from_str::<Value>(&key()).unwrap()["x"]}});
    let mut changed = metadata.clone();
    changed["manifest"]["name"] = "Altered".into();
    assert!(
      matches!(Package::open(resign(&bytes,header.clone(),changed)), Err(e) if e.contains("Manifest differs"))
    );
    for (field, value) in [
      ("compression", serde_json::json!("copy")),
      ("solid", serde_json::json!(false)),
      ("unplugged", serde_json::json!(true)),
      ("formatVersion", serde_json::json!(2)),
      ("unknown", serde_json::json!(true)),
    ] {
      let mut changed = metadata.clone();
      changed[field] = value;
      assert!(Package::open(resign(&bytes, header.clone(), changed)).is_err());
    }
    let mut extra = header;
    extra["jwk"]["d"] = "private".into();
    assert!(Package::open(resign(&bytes, extra, metadata)).is_err());
  }
  #[test]
  fn codecs_and_random_reads() {
    for codec in [Compression::Copy, Compression::Lzma2] {
      let bytes = pack_files(files(), &key(), codec).unwrap();
      let package = Package::open(bytes).unwrap();
      assert!(package.inspection.signature_valid);
      assert_eq!(
        package.read("backend/lazy.mjs").unwrap(),
        b"export default 42"
      );
      assert!(package.read("empty").unwrap().is_empty());
      assert!(package.read("../backend/main.mjs").is_err());
      assert!(package.read("missing").is_err());
    }
  }
  #[test]
  fn tampering_and_truncation_fail() {
    let bytes = pack_files(files(), &key(), Compression::Copy).unwrap();
    for position in [0, 8, 20, bytes.len() - 1] {
      let mut bad = bytes.clone();
      bad[position] ^= 1;
      assert!(Package::open(bad).is_err());
    }
    for length in [0, 8, 12, bytes.len() - 1] {
      assert!(Package::open(bytes[..length].to_vec()).is_err());
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(Package::open(trailing).is_err());
  }
  #[test]
  fn unsafe_and_conflicting_paths_fail() {
    for path in [
      "../x",
      "/x",
      "x\\y",
      "C:/x",
      "x/..",
      "x.",
      "x//a",
      "x\0y",
      "backend/MAIN.mjs",
      "backend/main.mjs/child",
      "plugin.json",
    ] {
      let mut files = files();
      files.push((path.into(), vec![1]));
      assert!(
        pack_files(files, &key(), Compression::Copy).is_err(),
        "{path}"
      );
    }
  }
  #[test]
  fn missing_manifest_and_entry_fail() {
    let mut missing = files();
    missing.remove(0);
    assert!(pack_files(missing, &key(), Compression::Copy).is_err());
    let mut missing = files();
    missing.remove(1);
    assert!(pack_files(missing, &key(), Compression::Copy).is_err());
  }
  #[test]
  fn duplicate_json_and_wrong_keys_fail() {
    assert!(json(br#"{"a":{"x":1,"x":2}}"#).is_err());
    assert!(json(br#"{"a":1,"\u0061":2}"#).is_err());
    let mut jwk: Value = serde_json::from_str(&key()).unwrap();
    jwk["x"] = "wrong".into();
    assert!(pack_files(files(), &jwk.to_string(), Compression::Copy).is_err());
    assert!(Compression::parse("deflate").is_err());
  }
  #[test]
  fn path_limits_fail() {
    assert!(resource_path(&"a".repeat(241)).is_err());
  }
}
