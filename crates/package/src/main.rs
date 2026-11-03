use mojito_package::{Compression, MAX_PACKAGE, Package, pack_directory};
use std::{
  fs,
  io::{Read, Write},
  path::Path,
};
fn read(path: &str) -> Result<Vec<u8>, String> {
  let mut bytes = Vec::new();
  fs::File::open(path)
    .map_err(|e| e.to_string())?
    .take(MAX_PACKAGE as u64 + 1)
    .read_to_end(&mut bytes)
    .map_err(|e| e.to_string())?;
  if bytes.len() > MAX_PACKAGE {
    return Err("Package too large".into());
  }
  Ok(bytes)
}
fn run() -> Result<(), String> {
  let args: Vec<_> = std::env::args().skip(1).collect();
  match args.first().map(String::as_str) {
    Some("pack") if args.len() == 4 || args.len() == 5 => {
      let compression = Compression::parse(args.get(4).map(String::as_str).unwrap_or("lzma2"))?;
      let output = Path::new(&args[3]);
      let parent = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
      let root = fs::canonicalize(&args[1]).map_err(|e| e.to_string())?;
      if fs::canonicalize(parent)
        .map_err(|e| e.to_string())?
        .starts_with(root)
      {
        return Err("Keep output outside the input directory".into());
      }
      let bytes = pack_directory(Path::new(&args[1]), Path::new(&args[2]), compression)?;
      let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .map_err(|e| e.to_string())?;
      file
        .write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
      println!(
        "{}",
        serde_json::to_string(&Package::open(bytes)?.inspection).map_err(|e| e.to_string())?
      );
    }
    Some("inspect" | "verify") if args.len() == 2 || args.len() == 3 => {
      let package = Package::open(read(&args[1])?)?;
      if let Some(fingerprint) = args.get(2)
        && package.inspection.signer.fingerprint != *fingerprint
      {
        return Err("Signer fingerprint differs".into());
      }
      // CLI verification also checks every member's CRC and exact decoded size.
      for file in &package.files {
        package.read(&file.path)?;
      }
      println!(
        "{}",
        serde_json::to_string_pretty(&package.inspection).map_err(|e| e.to_string())?
      );
    }
    Some("read") if args.len() == 3 => {
      std::io::stdout()
        .write_all(&Package::open(read(&args[1])?)?.read(&args[2])?)
        .map_err(|e| e.to_string())?;
    }
    Some("--help" | "-h") | None => println!(
      "mojito-package pack DIRECTORY PRIVATE_JWK OUTPUT [copy|lzma2]\nmojito-package inspect PACKAGE [EXPECTED_FINGERPRINT]\nmojito-package verify PACKAGE [EXPECTED_FINGERPRINT]\nmojito-package read PACKAGE PATH"
    ),
    _ => return Err("Invalid arguments; see --help".into()),
  }
  Ok(())
}
fn main() {
  if let Err(error) = run() {
    eprintln!("{error}");
    std::process::exit(1);
  }
}
