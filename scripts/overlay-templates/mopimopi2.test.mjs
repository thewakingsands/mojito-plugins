import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(
  new URL('../../packages/overlay-plugins/dist/mopimopi2/js/ui.js', import.meta.url),
  'utf8',
).catch((error) => {
  if (error.code !== 'ENOENT') throw error
  return null
})
const options = {
  skip: source === null && 'Template not built; run node scripts/overlay-templates/build.mjs mopimopi2',
}
const ui = source?.match(/^function ui\(\) \{[\s\S]*?^\}/m)?.[0]
if (source !== null) assert.ok(ui, 'Missing template ui() function')

function createPage() {
  let background
  const init = { q: { overlayBg: 0, overlayBgImg: '' }, Color: {}, Range: {}, Order: {} }
  const context = vm.createContext({
    init,
    window: { innerWidth: 900 },
    lastCombat: null,
    l: { size: { tab_graph: { inner: {} } } },
    view: 'notice',
    oHexColor: () => '',
    resizeWindow() {},
    $(selector) {
      return {
        css(styles) {
          if (selector === 'html') background = styles['background-image']
          return this
        },
        fadeIn() {},
        fadeOut() {},
        find() {
          return this
        },
      }
    },
  })
  vm.runInContext(ui, context)
  return {
    init,
    render() {
      vm.runInContext('ui()', context)
      return background
    },
  }
}

test('MopiMopi2 uses no image when the background is disabled or empty', options, () => {
  const page = createPage()
  assert.equal(page.render(), 'none')
  page.init.q.overlayBg = 1
  assert.equal(page.render(), 'none')
})

for (const image of ['images/handle.svg', 'https://example.com/background.png', 'data:image/png;base64,aGVsbG8=']) {
  test(`MopiMopi2 preserves the background through disable and re-enable: ${image}`, options, () => {
    const page = createPage()
    page.init.q.overlayBgImg = image
    assert.equal(page.render(), 'none')
    page.init.q.overlayBg = 1
    assert.equal(page.render(), `url(${image})`)
    page.init.q.overlayBg = 0
    assert.equal(page.render(), 'none')
    assert.equal(page.init.q.overlayBgImg, image)
    page.init.q.overlayBg = 1
    assert.equal(page.render(), `url(${image})`)
  })
}
