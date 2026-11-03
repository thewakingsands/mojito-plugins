//! Minimal ABI author example. All work finishes on the serial ABI thread; there are no background threads.
//! A real asynchronous plugin must join its workers before emitting stopped and before its last wake.
use plugin_protocol::{MAX_BYTES, Value, abi::*, message::Envelope};
use std::{
    collections::{BTreeMap, VecDeque},
    ffi::c_void,
    panic::{AssertUnwindSafe, catch_unwind},
};
struct State {
    activation: String,
    host_ctx: *mut c_void,
    wake: unsafe extern "C" fn(*mut c_void),
    output: VecDeque<Vec<u8>>,
    stopping: bool,
}
impl State {
    fn push(
        &mut self,
        kind: &str,
        fields: impl IntoIterator<Item = (String, Value)>,
    ) -> Result<(), String> {
        let mut message: BTreeMap<String, Value> = fields.into_iter().collect();
        message.insert("protocol".into(), Value::Number(1.0));
        message.insert(
            "activationId".into(),
            Value::String(self.activation.clone()),
        );
        message.insert("kind".into(), Value::String(kind.into()));
        let bytes = plugin_protocol::encode(&Value::Map(message))?;
        if self.output.len() >= 128
            || self.output.iter().map(Vec::len).sum::<usize>() + bytes.len() > 8 * 1024 * 1024
        {
            return Err("output full".into());
        }
        self.output.push_back(bytes);
        // Publish bytes before notifying. This callback never reenters submit/poll.
        unsafe { (self.wake)(self.host_ctx) };
        Ok(())
    }
}
fn guard(action: impl FnOnce() -> Result<Status, String>) -> Status {
    catch_unwind(AssertUnwindSafe(action))
        .ok()
        .and_then(Result::ok)
        .unwrap_or(INTERNAL_ERROR)
}
unsafe fn bytes<'a>(pointer: *const u8, length: u32) -> Result<&'a [u8], String> {
    if pointer.is_null() || length == 0 || length as usize > MAX_BYTES {
        return Err("invalid input".into());
    }
    Ok(unsafe { std::slice::from_raw_parts(pointer, length as usize) })
}
unsafe extern "C" fn create(
    host: *const HostApi,
    hello: *const u8,
    length: u32,
    output: *mut Instance,
) -> Status {
    if output.is_null() {
        return INVALID_ARGUMENT;
    }
    unsafe {
        *output = std::ptr::null_mut();
    }
    guard(|| {
        if host.is_null() {
            return Err("missing host".into());
        }
        let host = unsafe { &*host };
        if host.abi_version != 1
            || host.struct_size < std::mem::size_of::<HostApi>() as u32
            || host.host_ctx.is_null()
        {
            return Err("incompatible host".into());
        }
        let wake = host.wake.ok_or("missing wake")?;
        let hello = unsafe { bytes(hello, length)? };
        let Value::Map(fields) = plugin_protocol::decode(hello)? else {
            return Err("invalid hello".into());
        };
        let Some(Value::String(activation)) = fields.get("activationId") else {
            return Err("missing activation".into());
        };
        if Envelope::decode(hello, activation)?.kind() != "hello" {
            return Err("hello required".into());
        }
        let mut state = Box::new(State {
            activation: activation.clone(),
            host_ctx: host.host_ctx,
            wake,
            output: VecDeque::new(),
            stopping: false,
        });
        state.push(
            "request",
            [
                ("id".into(), Value::Number(0.0)),
                ("method".into(), Value::String("session.get".into())),
                ("params".into(), Value::Null),
            ],
        )?;
        unsafe {
            *output = Box::into_raw(state).cast();
        }
        Ok(OK)
    })
}
unsafe extern "C" fn submit(instance: Instance, input: *const u8, length: u32) -> Status {
    guard(|| {
        if instance.is_null() {
            return Err("missing instance".into());
        }
        let state = unsafe { &mut *(instance as *mut State) };
        if state.stopping {
            return Ok(STOPPING);
        }
        let message = Envelope::decode(unsafe { bytes(input, length)? }, &state.activation)?;
        if message.kind() == "response" && message.fields().get("id") == Some(&Value::Number(0.0)) {
            let success = message.fields().get("ok") == Some(&Value::Bool(true));
            state.push(
                "request",
                [
                    ("id".into(), Value::Number(1.0)),
                    ("method".into(), Value::String("log.write".into())),
                    (
                        "params".into(),
                        Value::Map(
                            [
                                ("level".into(), Value::String("info".into())),
                                (
                                    "message".into(),
                                    Value::String(
                                        if success {
                                            "Native example read the current session"
                                        } else {
                                            "Native example session was unavailable"
                                        }
                                        .into(),
                                    ),
                                ),
                            ]
                            .into(),
                        ),
                    ),
                ],
            )?;
            state.push("ready", [])?;
        }
        // Any retained data above was decoded/copied before returning OK; input bytes remain runner-owned.
        Ok(OK)
    })
}
unsafe extern "C" fn poll(
    instance: Instance,
    buffer: *mut u8,
    capacity: u32,
    length: *mut u32,
) -> Status {
    if length.is_null() {
        return INVALID_ARGUMENT;
    }
    unsafe {
        *length = 0;
    }
    guard(|| {
        if instance.is_null() {
            return Err("missing instance".into());
        }
        let state = unsafe { &mut *(instance as *mut State) };
        let Some(front) = state.output.front() else {
            return Ok(EMPTY);
        };
        unsafe {
            *length = front.len() as u32;
        }
        if front.len() > capacity as usize {
            return Ok(NEED_BUFFER);
        }
        if buffer.is_null() {
            return Err("missing output buffer".into());
        }
        let message = state.output.pop_front().unwrap();
        unsafe {
            std::ptr::copy_nonoverlapping(message.as_ptr(), buffer, message.len());
        }
        Ok(OK)
    })
}
unsafe extern "C" fn request_stop(instance: Instance) -> Status {
    guard(|| {
        if instance.is_null() {
            return Err("missing instance".into());
        }
        let state = unsafe { &mut *(instance as *mut State) };
        if !state.stopping {
            state.stopping = true;
            state.output.clear();
            state.push("stopped", [])?;
        }
        Ok(OK)
    })
}
unsafe extern "C" fn destroy(instance: Instance) -> Status {
    guard(|| {
        if instance.is_null() {
            return Err("missing instance".into());
        }
        let state = unsafe { &*(instance as *const State) };
        if !state.stopping || !state.output.is_empty() {
            return Err("destroy before stopped".into());
        }
        unsafe {
            drop(Box::from_raw(instance as *mut State));
        }
        Ok(OK)
    })
}
static API: PluginApi = PluginApi {
    abi_version: 1,
    struct_size: std::mem::size_of::<PluginApi>() as u32,
    create: Some(create),
    submit: Some(submit),
    poll: Some(poll),
    request_stop: Some(request_stop),
    destroy: Some(destroy),
};
#[unsafe(no_mangle)]
pub extern "C" fn mojito_plugin_get_api_v1() -> *const PluginApi {
    &API
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    unsafe extern "C" fn wake(context: *mut c_void) {
        unsafe { &*(context as *const AtomicUsize) }.fetch_add(1, Ordering::SeqCst);
    }
    fn envelope(kind: &str, fields: impl IntoIterator<Item = (String, Value)>) -> Vec<u8> {
        let mut value: BTreeMap<String, Value> = fields.into_iter().collect();
        value.insert("protocol".into(), Value::Number(1.0));
        value.insert("activationId".into(), Value::String("fixture".into()));
        value.insert("kind".into(), Value::String(kind.into()));
        plugin_protocol::encode(&Value::Map(value)).unwrap()
    }
    #[test]
    fn owns_abi_output_and_stops_without_future_callbacks() {
        let count = AtomicUsize::new(0);
        let host = HostApi {
            abi_version: 1,
            struct_size: 24,
            host_ctx: (&count as *const AtomicUsize).cast_mut().cast(),
            wake: Some(wake),
        };
        let hello = envelope("hello", []);
        let mut instance = std::ptr::null_mut();
        assert_eq!(
            unsafe { create(&host, hello.as_ptr(), hello.len() as u32, &mut instance) },
            OK
        );
        assert!(!instance.is_null());
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let mut length = 0;
        assert_eq!(
            unsafe { poll(instance, std::ptr::null_mut(), 0, &mut length) },
            NEED_BUFFER
        );
        let mut buffer = vec![0; length as usize];
        assert_eq!(
            unsafe {
                poll(
                    instance,
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    &mut length,
                )
            },
            OK
        );
        assert_eq!(
            Envelope::decode(&buffer, "fixture").unwrap().fields()["method"],
            Value::String("session.get".into())
        );
        let response = envelope(
            "response",
            [
                ("id".into(), Value::Number(0.0)),
                ("ok".into(), Value::Bool(true)),
                ("value".into(), Value::Null),
            ],
        );
        assert_eq!(
            unsafe { submit(instance, response.as_ptr(), response.len() as u32) },
            OK
        );
        buffer.resize(4096, 0);
        for kind in ["request", "ready"] {
            assert_eq!(
                unsafe {
                    poll(
                        instance,
                        buffer.as_mut_ptr(),
                        buffer.len() as u32,
                        &mut length,
                    )
                },
                OK
            );
            assert_eq!(
                Envelope::decode(&buffer[..length as usize], "fixture")
                    .unwrap()
                    .kind(),
                kind
            );
        }
        assert_eq!(unsafe { request_stop(instance) }, OK);
        assert_eq!(
            unsafe {
                poll(
                    instance,
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    &mut length,
                )
            },
            OK
        );
        assert_eq!(
            Envelope::decode(&buffer[..length as usize], "fixture")
                .unwrap()
                .kind(),
            "stopped"
        );
        let final_wakes = count.load(Ordering::SeqCst);
        assert_eq!(unsafe { request_stop(instance) }, OK);
        assert_eq!(unsafe { destroy(instance) }, OK);
        assert_eq!(count.load(Ordering::SeqCst), final_wakes);
    }
}
