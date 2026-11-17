import { droppedDirectory, selectedDirectory } from './files.js'

const element = (id) => document.getElementById(id)
const status = element('status')
const panel = element('result-panel')
const worker = new Worker('./worker.js', { type: 'module' })
let pending
let key = null // { jwk, name, filename, exported }
let directory = { name: '', files: [] }
let compression = 'lzma2'
let mode = 'pack'
let downloadUrl = ''
let publication
let busy = false

const sizeText = (bytes) =>
  bytes < 1024
    ? `${bytes} 字节`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`

function chip(id, kind, text) {
  const target = element(id)
  target.hidden = !text
  target.dataset.kind = kind
  target.textContent = text
}

function render() {
  const keyReady = !!key?.exported
  element('key-empty').hidden = !!key
  element('key-loaded').hidden = !key
  element('key-backup').hidden = !key || key.exported
  element('import-key').hidden = !!key
  element('generate-key').hidden = !!key
  element('export-key').hidden = !key
  element('clear-key').hidden = !key
  // The one lime button of this step: exporting while the new key is not backed up yet
  element('export-key').classList.toggle('primary', !!key && !key.exported)
  if (key) {
    element('key-name').textContent = key.name
    element('key-meta').textContent = key.exported ? '已备份 · 仅保存在此页面' : '尚未导出 · 仅保存在此页面'
  }
  element('key-step').dataset.state = keyReady ? 'done' : key ? 'attention' : 'todo'
  chip('key-chip', keyReady ? 'ok' : key ? 'attention' : 'off', keyReady ? '已就绪' : key ? '需要导出' : '未选择')

  const files = directory.files.length
  element('directory-empty').hidden = files > 0
  element('directory-loaded').hidden = files === 0
  element('directory-drop').classList.toggle('has-content', files > 0)
  if (files) {
    const size = directory.files.reduce((sum, { file }) => sum + file.size, 0)
    element('directory-name').textContent = directory.name || '所选目录'
    element('directory-meta').textContent = `${files.toLocaleString()} 个文件 · ${sizeText(size)}`
  }
  element('directory-step').dataset.state = files ? 'done' : 'todo'
  chip('directory-chip', files ? 'ok' : 'off', files ? '已选择' : '未选择')

  const packed = panel.dataset.state === 'done' && mode === 'pack'
  element('pack').disabled = !keyReady || files === 0
  // After packing, downloading is the next step: the result panel holds the lime button
  element('pack').classList.toggle('primary', !packed)
  element('pack-label').textContent = packed ? '重新打包' : '签名并打包'
  element('pack-hint').textContent = !key
    ? files
      ? '先导入或生成私钥。'
      : '先选择私钥和插件目录。'
    : !keyReady
      ? '先导出新生成的私钥。'
      : files
        ? '打包后会立即校验签名和全部文件。'
        : '先选择插件目录。'
  element('pack-step').dataset.state = packed ? 'done' : 'todo'
}

function show(state, text = '') {
  panel.dataset.state = state
  element('result-empty').hidden = state !== 'empty'
  element('result-busy').hidden = state !== 'busy'
  element('result-error').hidden = state !== 'error'
  element('result').hidden = state !== 'done'
  status.textContent = text
  if (state === 'busy') chip('result-chip', 'working', '处理中')
  else if (state === 'error') chip('result-chip', 'failed', '失败')
  else if (state === 'done') chip('result-chip', 'ok', '签名有效')
  else chip('result-chip', 'off', '')
  render()
}

function clearResult() {
  publication = undefined
  element('download').hidden = true
  element('download').removeAttribute('href')
  if (downloadUrl) URL.revokeObjectURL(downloadUrl)
  downloadUrl = ''
  show('empty')
}

// What failed is said in Chinese; the tool's own message stays as the detail
function showError(error, title = '处理失败', hint = '') {
  element('error-title').textContent = title
  element('error-hint').textContent = hint
  element('error-detail').textContent = error.message ?? String(error)
  show('error', `${title}：${error.message ?? error}`)
}

async function run(message, operation, title, hint) {
  clearResult()
  busy = true
  for (const id of ['pack-inputs', 'verify-inputs', 'pack-tab', 'verify-tab']) element(id).disabled = true
  show('busy', message)
  try {
    await operation()
  } catch (error) {
    showError(error, title, hint)
  } finally {
    busy = false
    for (const id of ['pack-inputs', 'verify-inputs', 'pack-tab', 'verify-tab']) element(id).disabled = false
    if (panel.dataset.state === 'busy') show('empty')
    render()
  }
}

function request(data, transfer = []) {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    worker.postMessage(data, transfer)
  })
}

worker.onmessage = ({ data }) => {
  const task = pending
  pending = undefined
  if (data.error) task?.reject(new Error(data.error))
  else task?.resolve(data)
}
worker.onerror = (event) => {
  event.preventDefault()
  const error = new Error(event.message || '无法加载处理工具，请刷新页面。')
  if (pending) {
    pending.reject(error)
    pending = undefined
  } else showError(error)
}

for (const name of ['pack', 'verify']) {
  element(`${name}-tab`).addEventListener('click', () => {
    if (mode === name) return
    mode = name
    for (const other of ['pack', 'verify']) {
      element(`${other}-panel`).hidden = other !== name
      element(`${other}-tab`).setAttribute('aria-pressed', String(other === name))
    }
    clearResult()
  })
}

// Signing key
element('import-key').addEventListener('click', () => element('key-file').click())
element('key-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file) return
  await run(
    '正在检查私钥…',
    async () => {
      const text = await file.text()
      await request({ action: 'validateKey', privateJwk: text })
      key = { jwk: text, name: file.name, filename: file.name, exported: true }
      show('empty', '私钥已导入。')
    },
    '无法导入私钥',
    '需要 JWK 格式的 Ed25519 私钥文件。',
  )
})
element('generate-key').addEventListener('click', async () => {
  await run(
    '正在生成私钥…',
    async () => {
      const data = await request({ action: 'generateKey' })
      key = { jwk: data.privateJwk, name: '新生成的私钥', filename: 'author.jwk', exported: false }
      show('empty', '私钥已生成，导出备份后才能打包。')
    },
    '无法生成私钥',
  )
})
element('export-key').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([key.jwk], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = key.filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  const first = !key.exported
  key.exported = true
  if (first) key.name = key.filename
  show(panel.dataset.state === 'done' ? 'done' : 'empty', '已下载私钥文件，请保存到安全的位置并备份。')
})
element('clear-key').addEventListener('click', () => {
  key = null
  clearResult()
})

// Plugin folder
function useDirectory(value) {
  directory = value
  render()
}
const chooseDirectory = () => element('directory').click()
element('choose-directory').addEventListener('click', chooseDirectory)
element('change-directory').addEventListener('click', chooseDirectory)
if (!('webkitdirectory' in element('directory'))) {
  element('choose-directory').disabled = true
  element('directory-unsupported').hidden = false
}
element('directory').addEventListener('change', async (event) => {
  const value = selectedDirectory(event.target.files)
  event.target.value = ''
  if (value.files.length === 0) return
  await run('正在读取目录…', async () => useDirectory(value), '无法读取目录')
})

function dropzone(id, operation) {
  const zone = element(id)
  zone.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (!busy) zone.classList.add('is-over')
  })
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-over')
  })
  zone.addEventListener('drop', async (event) => {
    event.preventDefault()
    zone.classList.remove('is-over')
    if (!busy) await operation(event.dataTransfer)
  })
}

dropzone('directory-drop', async (transfer) => {
  const items = Array.from(transfer.items).filter((item) => item.kind === 'file')
  const entry = items[0]?.webkitGetAsEntry?.()
  await run(
    '正在读取目录…',
    async () => {
      if (items.length !== 1 || !entry?.isDirectory) throw new Error('请拖入一个文件夹，或使用“选择文件夹”。')
      useDirectory(await droppedDirectory(entry))
    },
    '无法读取目录',
  )
})

element('compression').addEventListener('change', (event) => {
  compression = event.target.value
  if (panel.dataset.state === 'done' && mode === 'pack') clearResult()
})

// Result
function showResult(verification, bytes) {
  const { metadata, signer, files, size, sha256 } = verification
  const manifest = metadata.manifest
  element('plugin-name').textContent = manifest.name ?? manifest.id ?? '插件'
  element('plugin-id').textContent = `${manifest.id} · ${manifest.version}`
  const summary = element('summary')
  summary.replaceChildren()
  const total = files.reduce((sum, file) => sum + file.size, 0)
  for (const [label, value, mono] of [
    ['API 范围', manifest.apiVersion, true],
    ['入口', `${manifest.entry.kind} · ${manifest.entry.path}`, true],
    ['包内文件', `${files.length.toLocaleString()} 个 · 解压后 ${sizeText(total)}`],
    ['插件包', sizeText(size)],
  ]) {
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value ?? '—'
    if (mono) description.className = 'mono'
    summary.append(term, description)
  }
  publication = { size, sha256 }
  element('size').textContent = String(size)
  element('sha256').textContent = sha256
  element('fingerprint').textContent = signer.fingerprint
  element('metadata').textContent = JSON.stringify(metadata, null, 2)
  const rows = files.map((file) => {
    const row = document.createElement('tr')
    for (const text of [file.path, sizeText(file.size)]) {
      const cell = document.createElement('td')
      cell.textContent = text
      row.append(cell)
    }
    return row
  })
  element('members').replaceChildren(...rows)
  if (bytes) {
    downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
    element('download').href = downloadUrl
    element('download').download = `${manifest.id ?? 'plugin'}-${manifest.version ?? 'package'}.mojito`
    element('download').hidden = false
  }
  // Without a download the copy button is the entry's main action
  element('copy-publication').classList.toggle('primary', !bytes)
}

element('pack').addEventListener('click', async () => {
  await run(
    '正在读取文件…',
    async () => {
      const files = []
      for (const { path, file } of directory.files) files.push({ path, bytes: await file.arrayBuffer() })
      status.textContent = '正在签名并打包…'
      const data = await request(
        { action: 'pack', files, privateJwk: key.jwk, compression },
        files.map((file) => file.bytes),
      )
      showResult(data.verification, data.bytes)
      show('done', '已打包，签名与全部文件校验通过。')
    },
    '打包失败',
  )
})

async function verifyFile(file) {
  await run(
    '正在校验插件包…',
    async () => {
      const bytes = await file.arrayBuffer()
      const data = await request({ action: 'verify', bytes }, [bytes])
      showResult(data.verification)
      show('done', `${file.name}：签名与全部文件校验通过。`)
    },
    '校验未通过',
    '文件已损坏、在签名后被改动，或者不是 Mojito 插件包。',
  )
}
element('choose-package').addEventListener('click', () => element('package-file').click())
element('package-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]
  event.target.value = ''
  if (file) await verifyFile(file)
})
dropzone('package-drop', async (transfer) => {
  const files = Array.from(transfer.files)
  if (files.length !== 1) return showError(new Error('一次拖入一个 .mojito 文件。'), '无法校验')
  await verifyFile(files[0])
})

async function copy(button, text) {
  try {
    await navigator.clipboard.writeText(text)
    button.classList.add('copied')
    setTimeout(() => button.classList.remove('copied'), 1500)
  } catch {
    status.textContent = '无法写入剪贴板，请选中文本后手动复制。'
  }
}
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', () => copy(button, String(publication[button.dataset.copy])))
}
element('copy-publication').addEventListener('click', (event) =>
  copy(event.currentTarget, JSON.stringify(publication, null, 2)),
)

show('empty')
