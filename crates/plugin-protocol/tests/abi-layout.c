#include "../../../include/mojito_plugin_v1.h"
#include <stddef.h>
#ifdef __cplusplus
#define CHECK static_assert
#define ALIGNOF alignof
#else
#define CHECK _Static_assert
#define ALIGNOF _Alignof
#endif
CHECK(sizeof(void *) == 8, "x64 required");
CHECK(sizeof(mojito_host_api_v1) == 24, "host size");
CHECK(ALIGNOF(mojito_host_api_v1) == 8, "host alignment");
CHECK(offsetof(mojito_host_api_v1, host_ctx) == 8, "host context");
CHECK(offsetof(mojito_host_api_v1, wake) == 16, "host wake");
CHECK(sizeof(mojito_plugin_api_v1) == 48, "plugin size");
CHECK(ALIGNOF(mojito_plugin_api_v1) == 8, "plugin alignment");
CHECK(offsetof(mojito_plugin_api_v1, create) == 8, "create");
CHECK(offsetof(mojito_plugin_api_v1, submit) == 16, "submit");
CHECK(offsetof(mojito_plugin_api_v1, poll) == 24, "poll");
CHECK(offsetof(mojito_plugin_api_v1, request_stop) == 32, "stop");
CHECK(offsetof(mojito_plugin_api_v1, destroy) == 40, "destroy");
