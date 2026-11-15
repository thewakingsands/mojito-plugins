# 悬浮窗插件资源

[English](README.md) | 简体中文

`node scripts/overlay-templates/build.mjs` 把拉取到 `.tmp/overlay-templates/sources` 的固定版本上游源码
构建到 `packages/overlay-plugins/dist/<template>`，脚本中列出的每个模板一个目录。再构建
该工作区，补上各自的 manifest 和 worker。启动器独立构建。

脚本使用仓库中的 npm lock、各模板固定的构建工具（例如 Parcel 2.16.4）、Bun 1.3.11 和源码补丁。
依赖和生成的源码放在 `.tmp/overlay-templates`；固定版本的源码检出保持不变。运行时输出包含
SOURCE 元数据和适用的许可证；打过补丁的源码归档连同构建输入写到同级的 `dist/sources` 目录。

包内页面使用现有的带沙箱兼容 preload 和所属插件的 ResourceProvider。页面只能跳转到插件声明的文档。
打包和服务配置见 [悬浮窗插件工作区的 README](../../packages/overlay-plugins/README.zh-CN.md)。
