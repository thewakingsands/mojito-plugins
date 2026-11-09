export function resourceUrl(input: string): string {
  const url = new URL(input)
  if (url.username || url.password || url.hash) throw new Error('此界面只支持游戏资料查询')
  const allowed =
    url.origin === 'https://xivapi-v2.xivcdn.com'
      ? /^\/api\/(sheet\/(Item(?:\/\d+)?|Map\/\d+)|asset)$/.test(url.pathname) ||
        /^\/api\/asset\/map\/[A-Za-z0-9_-]+\/\d{2}$/.test(url.pathname) ||
        /^\/i\/\d{6}\/\d{6}\.png$/.test(url.pathname)
      : url.origin === 'https://map-v2.ffcafe.cn'
        ? !url.search && /^\/data\/(map|marker|region)\.json$/.test(url.pathname)
        : ['https://map-cdn.wakingsands.com', 'https://map.ffcafe.cn'].includes(url.origin)
          ? !url.search &&
            /^\/assets\/(data\/(map|mapMarker|region)\.json|tiles\/[a-z0-9_]+\/-?\d+_-?\d+_-?\d+\.jpg|maps\/[a-z0-9_]+\.png|files\/bg\.jpg)$/.test(
              url.pathname,
            )
          : url.origin === 'https://cafemaker.wakingsands.com' &&
            !url.search &&
            /^\/i\/\d{6}\/\d{6}\.png$/.test(url.pathname)
  if (!allowed) throw new Error('此界面只支持游戏资料查询')
  return url.href
}
