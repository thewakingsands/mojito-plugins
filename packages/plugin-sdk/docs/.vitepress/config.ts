import { type DefaultTheme, defineConfig, type UserConfig } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'

function sidebar(english: boolean): DefaultTheme.SidebarItem[] {
  const prefix = english ? '/en/' : '/'
  return [
    {
      text: english ? 'Get started' : '开始',
      items: [
        ['Overview', '概览', ''],
        ['Getting started', '快速开始', 'getting-started'],
        ['Core concepts', '核心概念', 'concepts'],
      ].map(([en, zh, path]) => ({ text: english ? en : zh, link: `${prefix}${path}` })),
    },
    {
      text: english ? 'Build a plugin' : '开发插件',
      items: [
        ['Pages and overlays', '页面与悬浮窗', 'features'],
        ['Style', '样式', 'style'],
        ['Development', '开发与调试', 'development'],
        ['Manifest', 'Manifest', 'manifest'],
        ['Permissions', '权限', 'permissions'],
        ['Native plugins', '原生插件', 'native'],
      ].map(([en, zh, path]) => ({ text: english ? en : zh, link: `${prefix}${path}` })),
    },
    {
      text: 'Plugin API',
      items: [
        ['Services and lifecycle', '服务与生命周期', 'context'],
        ['Data and events', '数据与事件', 'data-model'],
        ['View bridge', '页面 bridge', 'view'],
        ['SDK entry points', 'SDK 入口', 'exports'],
      ].map(([en, zh, path]) => ({ text: english ? en : zh, link: `${prefix}api/${path}` })),
    },
    {
      text: english ? 'Distribute' : '分发插件',
      items: [
        ['Package and sign', '打包与签名', 'packaging'],
        ['Publish and update', '发布与更新', 'publishing'],
      ].map(([en, zh, path]) => ({ text: english ? en : zh, link: `${prefix}${path}` })),
    },
  ]
}

export default defineConfig({
  title: 'Mojito',
  description: 'Mojito plugin development documentation · Mojito 插件开发文档',
  base: '/mojito-plugins/docs/',
  markdown: { languageAlias: { mjs: 'javascript' } },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '开发文档', link: '/' },
          { text: '验签工具', link: 'https://thewakingsands.github.io/mojito-plugins/', target: '_self' },
        ],
        sidebar: sidebar(false),
        outline: { label: '本页内容' },
        docFooter: { prev: '上一页', next: '下一页' },
        returnToTopLabel: '返回顶部',
        sidebarMenuLabel: '目录',
        darkModeSwitchLabel: '主题',
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Documentation', link: '/en/' },
          { text: 'Package verifier', link: 'https://thewakingsands.github.io/mojito-plugins/', target: '_self' },
        ],
        sidebar: sidebar(true),
      },
    },
  },
  themeConfig: {
    socialLinks: [{ icon: 'github', link: 'https://github.com/thewakingsands/mojito-plugins' }],
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                noResultsText: '没有找到结果',
                resetButtonTitle: '清除搜索',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
  },
  vite: {
    // VitePress 1 and the plugin resolve different Vite type versions.
    plugins: llmstxt({
      domain: 'https://thewakingsands.github.io',
      excludeIndexPage: false,
      injectLLMHint: false,
    }) as unknown as NonNullable<UserConfig['vite']>['plugins'],
  },
})
