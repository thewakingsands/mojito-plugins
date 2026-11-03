//! Windows x64 C ABI layouts; no plugin is loaded by this crate.
use std::ffi::c_void;
pub type Instance = *mut c_void;
pub type Status = u32;
pub const OK: Status = 0;
pub const EMPTY: Status = 1;
pub const NEED_BUFFER: Status = 2;
pub const BUSY: Status = 3;
pub const INVALID_ARGUMENT: Status = 256;
pub const INTERNAL_ERROR: Status = 257;
pub const STOPPING: Status = 258;
#[repr(C)]
pub struct HostApi {
  pub abi_version: u32,
  pub struct_size: u32,
  pub host_ctx: *mut c_void,
  pub wake: Option<unsafe extern "C" fn(*mut c_void)>,
}
#[repr(C)]
pub struct PluginApi {
  pub abi_version: u32,
  pub struct_size: u32,
  pub create: Option<unsafe extern "C" fn(*const HostApi, *const u8, u32, *mut Instance) -> Status>,
  pub submit: Option<unsafe extern "C" fn(Instance, *const u8, u32) -> Status>,
  pub poll: Option<unsafe extern "C" fn(Instance, *mut u8, u32, *mut u32) -> Status>,
  pub request_stop: Option<unsafe extern "C" fn(Instance) -> Status>,
  pub destroy: Option<unsafe extern "C" fn(Instance) -> Status>,
}
#[cfg(target_pointer_width = "64")]
const _: () = {
  use std::mem::{align_of, offset_of, size_of};
  assert!(size_of::<HostApi>() == 24 && align_of::<HostApi>() == 8);
  assert!(offset_of!(HostApi, host_ctx) == 8 && offset_of!(HostApi, wake) == 16);
  assert!(size_of::<PluginApi>() == 48 && align_of::<PluginApi>() == 8);
  assert!(offset_of!(PluginApi, create) == 8);
  assert!(offset_of!(PluginApi, submit) == 16);
  assert!(offset_of!(PluginApi, poll) == 24);
  assert!(offset_of!(PluginApi, request_stop) == 32);
  assert!(offset_of!(PluginApi, destroy) == 40);
};
