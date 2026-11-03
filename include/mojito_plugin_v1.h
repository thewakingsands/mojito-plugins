#ifndef MOJITO_PLUGIN_V1_H
#define MOJITO_PLUGIN_V1_H
#include <stdint.h>
#if defined(_WIN32)
# if defined(MOJITO_PLUGIN_BUILD)
#  define MOJITO_PLUGIN_EXPORT __declspec(dllexport)
# else
#  define MOJITO_PLUGIN_EXPORT __declspec(dllimport)
# endif
#else
# define MOJITO_PLUGIN_EXPORT __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
typedef void *mojito_instance_v1;
typedef uint32_t mojito_status_v1;
#define MOJITO_OK 0u
#define MOJITO_EMPTY 1u
#define MOJITO_NEED_BUFFER 2u
#define MOJITO_BUSY 3u
#define MOJITO_INVALID_ARGUMENT 256u
#define MOJITO_INTERNAL_ERROR 257u
#define MOJITO_STOPPING 258u

typedef struct mojito_host_api_v1 {
  uint32_t abi_version;
  uint32_t struct_size;
  void *host_ctx;
  void (*wake)(void *host_ctx);
} mojito_host_api_v1;

typedef struct mojito_plugin_api_v1 {
  uint32_t abi_version;
  uint32_t struct_size;
  mojito_status_v1 (*create)(const mojito_host_api_v1 *host, const uint8_t *hello,
                            uint32_t length, mojito_instance_v1 *out_instance);
  mojito_status_v1 (*submit)(mojito_instance_v1 instance, const uint8_t *message, uint32_t length);
  mojito_status_v1 (*poll)(mojito_instance_v1 instance, uint8_t *buffer,
                          uint32_t capacity, uint32_t *out_length);
  mojito_status_v1 (*request_stop)(mojito_instance_v1 instance);
  mojito_status_v1 (*destroy)(mojito_instance_v1 instance);
} mojito_plugin_api_v1;

/* Tables are borrowed. Copy host callback fields; never retain the host table pointer.
 * wake is thread-safe and notification-only. No callback may occur after destroy.
 * See MJT-28 spec v20 for lifetime, ownership and nonblocking export requirements. */
MOJITO_PLUGIN_EXPORT const mojito_plugin_api_v1 *mojito_plugin_get_api_v1(void);
#ifdef __cplusplus
}
#endif
#endif
