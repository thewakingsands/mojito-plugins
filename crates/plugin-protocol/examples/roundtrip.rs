//! Test harness only: re-encode one hex MessagePack value per stdin line.
use std::io::{self, BufRead};
fn main() {
  for line in io::stdin().lock().lines() {
    let line = line.unwrap();
    assert!(line.len() % 2 == 0);
    let bytes: Vec<u8> = (0..line.len())
      .step_by(2)
      .map(|i| u8::from_str_radix(&line[i..i + 2], 16).unwrap())
      .collect();
    let value = plugin_protocol::decode(&bytes).unwrap();
    let result = plugin_protocol::encode(&value).unwrap();
    println!(
      "{}",
      result
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
    );
  }
}
