//! Common envelope validation. Method payload schemas and authority belong to the router.
use crate::{Result, Value};
use std::collections::BTreeMap;
pub const KINDS: &[&str] = &[
  "hello",
  "ready",
  "request",
  "response",
  "cancel",
  "subscribe",
  "subscribed",
  "batch",
  "ack",
  "unsubscribe",
  "subscriptionClosed",
  "capabilitiesChanged",
  "clockSync",
  "clockReset",
  "stop",
  "stopped",
];
#[derive(Clone, Debug, PartialEq)]
pub struct Envelope {
  activation_id: String,
  kind: String,
  fields: BTreeMap<String, Value>,
}
impl Envelope {
  pub fn decode(bytes: &[u8], expected_activation: &str) -> Result<Self> {
    let Value::Map(mut fields) = crate::decode(bytes)? else {
      return Err("expected message envelope".into());
    };
    if fields.remove("protocol") != Some(Value::Number(1.0)) {
      return Err("unsupported protocol version".into());
    }
    let Some(Value::String(activation_id)) = fields.remove("activationId") else {
      return Err("missing activation".into());
    };
    if expected_activation.is_empty() || activation_id != expected_activation {
      return Err("wrong activation".into());
    }
    let Some(Value::String(kind)) = fields.remove("kind") else {
      return Err("missing message kind".into());
    };
    if !KINDS.contains(&kind.as_str()) {
      return Err("unknown message kind".into());
    }
    Ok(Self {
      activation_id,
      kind,
      fields,
    })
  }
  pub fn kind(&self) -> &str {
    &self.kind
  }
  pub fn activation_id(&self) -> &str {
    &self.activation_id
  }
  pub fn fields(&self) -> &BTreeMap<String, Value> {
    &self.fields
  }
  pub fn encode(&self) -> Result<Vec<u8>> {
    let mut fields = self.fields.clone();
    fields.insert("protocol".into(), Value::Number(1.0));
    fields.insert(
      "activationId".into(),
      Value::String(self.activation_id.clone()),
    );
    fields.insert("kind".into(), Value::String(self.kind.clone()));
    crate::encode(&Value::Map(fields))
  }
}
