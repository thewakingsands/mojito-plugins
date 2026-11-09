import { expect, it } from 'vitest'
import { resourceUrl } from './resources.js'

it('permits map data, composed maps, legacy tiles, icons and game data queries', () => {
  for (const url of [
    'https://xivapi-v2.xivcdn.com/api/sheet/Item?rows=1,2',
    'https://xivapi-v2.xivcdn.com/api/asset?path=ui/icon/060000/060003.tex',
    'https://xivapi-v2.xivcdn.com/api/asset/map/s1d1/00?format=webp',
    'https://map-v2.ffcafe.cn/data/map.json',
    'https://map-v2.ffcafe.cn/data/marker.json',
    'https://map-v2.ffcafe.cn/data/region.json',
    'https://map-cdn.wakingsands.com/assets/data/mapMarker.json',
    'https://map.ffcafe.cn/assets/data/map.json',
    'https://map-cdn.wakingsands.com/assets/tiles/f1f1_00/-1_0_2.jpg',
    'https://cafemaker.wakingsands.com/i/060000/060003.png',
  ])
    expect(resourceUrl(url)).toBe(url)
})
it('rejects unrelated paths, credentials and origins', () => {
  for (const url of [
    'https://example.test/api/asset',
    'https://xivapi-v2.xivcdn.com/api/asset/map/s1d1/private',
    'https://xivapi-v2.xivcdn.com/api/asset/map/s1d1/00/extra',
    'https://map-v2.ffcafe.cn/data/other.json',
    'https://map-v2.ffcafe.cn/data/map.json?secret=1',
    'https://map-cdn.wakingsands.com/private.json',
    'https://map-cdn.wakingsands.com/assets/data/world.json',
    'https://cafemaker.wakingsands.com/api/search',
    'https://user:password@map-cdn.wakingsands.com/assets/data/map.json',
    'https://map-cdn.wakingsands.com/assets/data/map.json?secret=1',
  ])
    expect(() => resourceUrl(url)).toThrow()
})
