# 插件开发文档

Mojito 插件可以读取游戏数据，在 Mojito 里添加页面、设置页和悬浮窗，也可以朗读文字或给其他插件提供服务。插件用 JavaScript/TypeScript 和网页技术编写，不需要修改 Mojito 本身。

## 插件由什么组成

```text
my-plugin/
├─ plugin.json      插件的声明：ID、名称、版本、需要的权限、入口文件
├─ entry.mjs        后台：插件的逻辑，Mojito 启动插件时运行它
└─ main.html …      页面和悬浮窗（可选）：普通网页，显示后台整理好的数据
```

- **后台**是一个导出 `activate(context)` 函数的 JavaScript 模块，运行在 Mojito 提供的隔离环境（浏览器 Worker）里。所有能力都通过 `context` 使用：读取会话和游戏状态、订阅事件、保存配置、注册页面等。
- **页面**是插件包里的 HTML 文件。后台注册以后，页面会出现在 Mojito 的侧栏、首页、设置或悬浮窗里。页面通过 bridge 读取后台发布的数据，并向后台发送命令。
- **`plugin.json`**（manifest）声明插件是谁、从哪个文件启动、要用哪些权限（capability）。用户安装时会看到这些权限。

只需要后台的插件可以没有页面；Windows 原生 DLL 也可以作为后台，见[原生插件](native.md)。

## 从开发到发布

1. **开发**：在 Mojito 的开发者工具里登记插件目录，直接运行，不需要打包。见[快速开始](getting-started.md)。
2. **打包签名**：把构建好的插件目录打成一个用你的私钥签名的 `.mojito` 文件。见[打包与签名](packaging.md)。
3. **发布**：把 `.mojito` 和一个描述它的 `catalog.json` 放到网上。见[发布与更新](publishing.md)。
4. **安装**：用户在 Mojito 里添加你的 catalog 地址，选择插件安装，并确认它的权限。

## 阅读顺序

先完成[快速开始](getting-started.md)，再读[核心概念](concepts.md)。之后按需要阅读：

- 添加页面和悬浮窗：[页面与悬浮窗](features.md)、[样式](style.md)
- 调试和排查问题：[开发与调试](development.md)
- 查方法和数据：[服务与生命周期](api/context.md)、[数据与事件](api/data-model.md)、[页面 bridge](api/view.md)

## 兼容版本

本文档对应 Plugin API **2.0.0**，manifest 里写 `"apiVersion": "^2.0.0"`。API 2 与 1.x 不兼容。SDK 的 npm 版本号和 Plugin API 版本号各自独立。

完整的方法签名随 SDK 的类型声明（`.d.ts`）提供，编辑器里可以直接查看。

## 给 Agent

从 [llms.txt](./llms.txt) 找到主题的 Markdown，也可以读取 [llms-full.txt](./llms-full.txt)。两者都从本网站的正文生成。
