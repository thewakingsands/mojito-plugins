import { droppedDirectory, selectedDirectory } from './files.js'

const element = (id) => document.getElementById(id)
const status = element('status')
const result = element('result')
const worker = new Worker('./worker.js', { type: 'module' })
let pending
let privateJwk = ''
let keyName = ''
let keyFilename = ''
let keyExported = false
let directory = { name: '', files: [] }
let downloadUrl = ''
let publication
let busy = false

function updateKey() {
  element('key-state').textContent = privateJwk ? `${keyName}${keyExported ? '' : '（请先导出备份）'}` : '尚未选择私钥'
  element('export-key').disabled = !privateJwk
  element('clear-key').disabled = !privateJwk
  element('pack').disabled = !privateJwk || !keyExported || directory.files.length === 0
}

function clearResult() {
  result.hidden = true
  publication = undefined
  element('download').hidden = true
  element('download').removeAttribute('href')
  if (downloadUrl) URL.revokeObjectURL(downloadUrl)
  downloadUrl = ''
  status.textContent = ''
  status.className = ''
}

function showError(error) {
  clearResult()
  status.className = 'error'
  status.textContent = `处理失败：${error.message ?? error}`
}

async function run(message, operation) {
  clearResult()
  busy = true
  element('pack-inputs').disabled = true
  element('verify-inputs').disabled = true
  element('pack-tab').disabled = true
  element('verify-tab').disabled = true
  status.textContent = message
  try {
    await operation()
  } catch (error) {
    showError(error)
  } finally {
    busy = false
    element('pack-inputs').disabled = false
    element('verify-inputs').disabled = false
    element('pack-tab').disabled = false
    element('verify-tab').disabled = false
    updateKey()
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

for (const mode of ['pack', 'verify']) {
  element(`${mode}-tab`).addEventListener('click', () => {
    clearResult()
    for (const name of ['pack', 'verify']) {
      element(`${name}-panel`).hidden = name !== mode
      element(`${name}-tab`).setAttribute('aria-pressed', String(name === mode))
    }
  })
}

element('import-key').addEventListener('click', () => element('key-file').click())
element('key-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file) return
  await run('正在导入私钥…', async () => {
    const text = await file.text()
    await request({ action: 'validateKey', privateJwk: text })
    privateJwk = text
    keyName = file.name
    keyFilename = file.name
    keyExported = true
    status.textContent = '私钥已导入。'
  })
})
element('generate-key').addEventListener('click', async () => {
  await run('正在生成私钥…', async () => {
    const data = await request({ action: 'generateKey' })
    privateJwk = data.privateJwk
    keyName = '新生成的私钥'
    keyFilename = 'author.jwk'
    keyExported = false
    status.textContent = '私钥已生成，请先导出备份。'
  })
})
element('export-key').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([privateJwk], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = keyFilename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  keyExported = true
  updateKey()
  status.textContent = '已请求下载私钥，请确认保存并妥善备份。'
})
element('clear-key').addEventListener('click', () => {
  clearResult()
  privateJwk = ''
  keyName = ''
  keyFilename = ''
  keyExported = false
  updateKey()
})

function useDirectory(value) {
  directory = value
  const size = value.files.reduce((sum, { file }) => sum + file.size, 0)
  element('directory-summary').textContent =
    `${value.name || '所选目录'} · ${value.files.length} 个文件 · ${size.toLocaleString()} 字节`
}

element('choose-directory').addEventListener('click', () => element('directory').click())
if (!('webkitdirectory' in element('directory'))) {
  element('choose-directory').disabled = true
  element('directory-summary').textContent = '此浏览器不支持选择文件夹，请使用支持此功能的浏览器。'
}
element('directory').addEventListener('change', async (event) => {
  const value = selectedDirectory(event.target.files)
  event.target.value = ''
  await run('正在读取目录…', async () => {
    useDirectory(value)
    status.textContent = ''
  })
})
element('compression').addEventListener('change', clearResult)

function dropzone(id, operation) {
  const zone = element(id)
  zone.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (!busy) zone.classList.add('is-over')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'))
  zone.addEventListener('drop', async (event) => {
    event.preventDefault()
    zone.classList.remove('is-over')
    if (!busy) await operation(event.dataTransfer)
  })
}

dropzone('directory-drop', async (transfer) => {
  const items = Array.from(transfer.items).filter((item) => item.kind === 'file')
  const entry = items[0]?.webkitGetAsEntry?.()
  await run('正在读取目录…', async () => {
    directory = { name: '', files: [] }
    element('directory-summary').textContent = '目录根部需包含 plugin.json。'
    if (items.length !== 1 || !entry?.isDirectory) throw new Error('请拖入一个文件夹，或使用“选择文件夹”。')
    useDirectory(await droppedDirectory(entry))
    status.textContent = ''
  })
})

function showResult(verification, bytes) {
  const { metadata, signer, files, size, sha256 } = verification
  const manifest = metadata.manifest
  element('plugin-name').textContent = manifest.name ?? '插件信息'
  const summary = element('summary')
  summary.replaceChildren()
  for (const [label, value] of [
    ['插件 ID', manifest.id],
    ['版本', manifest.version],
    ['API 范围', manifest.apiVersion],
    ['入口', `${manifest.entry.kind} · ${manifest.entry.path}`],
  ]) {
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value ?? '—'
    summary.append(term, description)
  }
  publication = { size, sha256 }
  element('size').textContent = String(size)
  element('sha256').textContent = sha256
  element('fingerprint').textContent = signer.fingerprint
  element('metadata').textContent = JSON.stringify(metadata, null, 2)
  element('members').textContent = files.map((file) => `${file.path} (${file.size} 字节)`).join('\n')
  if (bytes) {
    downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
    element('download').href = downloadUrl
    element('download').download = `${manifest.id ?? 'plugin'}-${manifest.version ?? 'package'}.mojito`
    element('download').hidden = false
  }
  result.hidden = false
}

element('pack').addEventListener('click', async () => {
  await run('正在读取文件…', async () => {
    const files = []
    for (const { path, file } of directory.files) files.push({ path, bytes: await file.arrayBuffer() })
    status.textContent = '正在签名并打包…'
    const data = await request(
      { action: 'pack', files, privateJwk, compression: element('compression').value },
      files.map((file) => file.bytes),
    )
    showResult(data.verification, data.bytes)
    status.textContent = '打包完成，签名与全部文件校验通过。'
  })
})

async function verifyFile(file) {
  await run('正在校验插件包…', async () => {
    const bytes = await file.arrayBuffer()
    const data = await request({ action: 'verify', bytes }, [bytes])
    showResult(data.verification)
    status.textContent = '签名与全部文件校验通过。'
  })
}
element('choose-package').addEventListener('click', () => element('package-file').click())
element('package-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]
  event.target.value = ''
  if (file) await verifyFile(file)
})
dropzone('package-drop', async (transfer) => {
  const files = Array.from(transfer.files)
  if (files.length !== 1) return showError(new Error('请选择一个 .mojito 文件。'))
  await verifyFile(files[0])
})

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    status.className = ''
    status.textContent = '已复制。'
  } catch {
    status.textContent = '复制失败，请选中发布信息手动复制。'
  }
}
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    await copy(String(publication[button.dataset.copy]))
  })
}
element('copy-publication').addEventListener('click', async () => {
  await copy(JSON.stringify(publication, null, 2))
})
