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

默认构建与官方打包共用 `templates.mjs` 清单。MopiMopi2 在取得再分发许可前不参与默认构建和官方打包；显式选择单个模板的构建入口保留供调查。官方打包会清理 `dist/official`，仅复制清单中模板的源码归档。

随包 Aldrich、Lato 和 Material Icons 字体的补充许可记录见 [font-licenses](font-licenses/README.zh-CN.md)，已有 Fontsource 许可证继续随包提供。
