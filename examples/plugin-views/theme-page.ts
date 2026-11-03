import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const view = await connectView()
const theme = document.createElement('p')
document.body.append(theme)
const media = matchMedia('(prefers-color-scheme: dark)')
const show = () => {
  theme.textContent = `当前主题：${media.matches ? '深色' : '浅色'} · ${view.identity.placement}`
}
media.addEventListener('change', show)
show()
