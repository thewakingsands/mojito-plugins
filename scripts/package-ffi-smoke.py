"""Exercise the exported ABI with ctypes, including allocator ownership."""
import ctypes
import json
from pathlib import Path
import platform

root = Path(__file__).resolve().parent.parent
name = {"Windows": "mojito_package.dll", "Linux": "libmojito_package.so", "Darwin": "libmojito_package.dylib"}[platform.system()]
library = ctypes.CDLL(str(root / "target/release" / name))
verify = library.mojito_package_verify
verify.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint64, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_size_t)]
verify.restype = ctypes.c_int32
free = library.mojito_package_free
free.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
free.restype = None
for _ in range(100):
    output, size = ctypes.c_void_p(), ctypes.c_size_t()
    status = verify(b"invalid package", 15, 268435456, ctypes.byref(output), ctypes.byref(size))
    try:
        assert status == 1
        assert json.loads(ctypes.string_at(output, size.value))["error"]
    finally:
        free(output, size)
assert verify(None, 0, 1, None, None) == 2
free(None, 0)
print("Native verify/free exports and repeated error-buffer release passed")
