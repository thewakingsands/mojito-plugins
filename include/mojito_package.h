#ifndef MOJITO_PACKAGE_H
#define MOJITO_PACKAGE_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Input is borrowed and immutable until return. Output is UTF-8 JSON, not NUL
 * terminated. Always free a non-null output, including on failure.
 * Status: 0 verified, 1 invalid package, 2 invalid arguments, 3 caught panic.
 * max_package_bytes must be in 1..268435456. Invalid output pointers return 2.
 * All non-null pointers must designate valid storage. */
int32_t mojito_package_verify(const uint8_t *input, size_t input_len,
    uint64_t max_package_bytes, uint8_t **output, size_t *output_len);
void mojito_package_free(uint8_t *output, size_t output_len);
#ifdef __cplusplus
}
#endif
#endif
