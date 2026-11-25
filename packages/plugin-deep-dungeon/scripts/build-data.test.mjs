import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { convertCatalog } from './build-data.mjs'

const root = new URL('../../../vendor/monsterdex-data/', import.meta.url)
const read = (file) => readFileSync(new URL(file, root), 'utf8')
const eo = 'DD/EO/51-100.yml'
const potd = 'DD/PotD/51-100.yml'

test('preserves the verified rows and moves deepeye notes from both source files', () => {
  const { catalog, sourceCount } = convertCatalog(read)
  assert.equal(sourceCount, 706)
  assert.equal(catalog.monsters.length, 704)
  assert.equal(catalog.nameColumn, 0)
  const monster = (id) => catalog.monsters.find((entry) => entry.nameId === id)
  assert.equal(monster(12161).upstreamName, 'Orthos apa')
  assert.equal(monster(12161).weakness.bind, 'immune')
  assert.equal(monster(12210).upstreamName, 'Orthos deepeye')
  assert.equal(monster(12210).sourcePath, eo)
  assert.equal(monster(12210).weakness.bind, 'effective')
  for (const [key, language] of [
    ['en', 'en'],
    ['zhCN', 'zh-CN'],
  ]) {
    const source = read(`Localization/${language}/${eo}`)
    const { notes } = monster(12210)
    assert(notes[key].trim())
    assert.equal(notes[key], parse(source)[12161])
    assert.notEqual(monster(12161).notes[key], notes[key])
  }
  const { sourcePath, threat, undead, notes } = monster(5298)
  assert.deepEqual({ sourcePath, threat, undead, notes }, { sourcePath: potd, threat: 'Easy', undead: true, notes: {} })
  assert.equal(catalog.floors.find((floor) => floor.key === 'EO52')?.redirect, 'EO51')
  assert.equal(catalog.floors.filter((floor) => !floor.redirect).length, 51)
})

for (const [file, edit, error] of [
  [eo, (text) => text.replace('Threat: Caution', 'Threat: Unrecognized'), /unknown Threat Unrecognized/],
  [eo, () => 'broken: [', /51-100.yml:.*flow sequence/i],
  [potd, (text) => text.replace('5298-Necrose knight:', '5298-New knight:'), /Override 5298 .*candidate changed/s],
  [
    'DD/Special.yml',
    (text) => `${text}\n12247-extra:\n  InstanceContentType: DeepDungeon\n`,
    /Unregistered duplicate ID 12247/,
  ],
]) {
  test(`fails on invalid or changed records in ${file}`, () => {
    assert.throws(() => convertCatalog((name) => (name === file ? edit(read(name)) : read(name))), error)
  })
}
