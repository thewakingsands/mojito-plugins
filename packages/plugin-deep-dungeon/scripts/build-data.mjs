import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { overrides } from './overrides.mjs'

const dungeons = ['PotD', 'HoH', 'EO', 'PT']
const controls = ['Stun', 'Heavy', 'Slow', 'Sleep', 'Bind']
const weaknessFlags = [...controls, ...controls.map((name) => `${name}Unknown`), 'Undead']
const languages = [
  ['en', 'en'],
  ['zhCN', 'zh-CN'],
]
const integer = (value) => Number.isSafeInteger(value) && value > 0
const mapping = (value) => value && typeof value === 'object' && !Array.isArray(value)

function dungeonFor(file) {
  const key = file.split('/')[1]
  assert(dungeons.includes(key), `${file}: unknown dungeon`)
  return key
}

export function convertCatalog(read) {
  const files = []
  const load = (file) => {
    files.push(file)
    try {
      return read(file).replace(/^\uFEFF/, '')
    } catch (error) {
      throw new Error(`${file}: ${error.message}`, { cause: error })
    }
  }
  const yaml = (file) => {
    const doc = parseDocument(load(file))
    assert(!doc.errors.length, `${file}: ${doc.errors.map((error) => error.message).join(' ')}`)
    const value = doc.toJS()
    assert(mapping(value), `${file}: expected a mapping`)
    return value
  }
  const localized = (file) =>
    languages.map(([language, directory]) => {
      const input = `Localization/${directory}/${file}`
      const entries = yaml(input)
      for (const [key, value] of Object.entries(entries))
        assert(typeof value === 'string', `${input} ${key}: expected text`)
      return [language, entries]
    })
  const index = JSON.parse(load('index.json'))
  const candidates = new Map()
  let sourceCount = 0
  for (const file of index.MobData.filter((name) => name.startsWith('DD/'))) {
    const source = yaml(file)
    const translations = localized(file)
    const groups = file === 'DD/Special.yml' ? dungeons : [dungeonFor(file)]
    const ids = new Set()
    for (const [key, record] of Object.entries(source)) {
      const parsed = /^(\d+)-(.+)$/.exec(key)
      assert(parsed && integer(Number(parsed[1])) && mapping(record), `${file} ${key}: invalid monster record`)
      const nameId = Number(parsed[1])
      assert(!ids.has(nameId), `${file} ${key}: duplicate monster ID ${nameId} in file`)
      ids.add(nameId)
      const where = `${file} ${key}`
      const upstreamName = parsed[2]
      const {
        InstanceContentType,
        Aggro: aggro = 'Undefined',
        Threat: threat = 'Undefined',
        Weakness: flags = [],
      } = record
      assert.equal(InstanceContentType, 'DeepDungeon', `${where}: invalid InstanceContentType`)
      assert(
        ['Undefined', 'Sight', 'Sound', 'Proximity', 'Boss', 'Bloodlust', 'Magic'].includes(aggro),
        `${where}: unknown Aggro ${aggro}`,
      )
      assert(
        ['Undefined', 'Easy', 'Caution', 'Dangerous', 'Vicious'].includes(threat),
        `${where}: unknown Threat ${threat}`,
      )
      assert(
        Array.isArray(flags) && flags.every((flag) => weaknessFlags.includes(flag)),
        `${where}: unknown Weakness ${flags}`,
      )
      const weakness = Object.fromEntries(
        controls.map((name) => [
          name.toLowerCase(),
          flags.includes(`${name}Unknown`) ? 'unknown' : flags.includes(name) ? 'effective' : 'immune',
        ]),
      )
      const notes = Object.fromEntries(
        translations.flatMap(([language, entries]) =>
          Object.hasOwn(entries, nameId)
            ? [[language, entries[nameId].replace(/%%/g, '%').replaceAll('\\n', '\n')]]
            : [],
        ),
      )
      const monster = {
        nameId,
        upstreamName,
        dungeons: groups,
        aggro,
        threat,
        weakness,
        undead: flags.includes('Undead'),
        notes,
        sourcePath: file,
      }
      const matches = candidates.get(nameId) ?? []
      matches.push({ monster, record })
      candidates.set(nameId, matches)
      sourceCount++
    }
  }

  for (const { id, keep, drop, notesTo } of overrides) {
    const matches = candidates.get(id) ?? []
    const where = `Override ${id} (${keep[0]}, ${drop[0]})`
    assert.equal(matches.length, 2, `${where}: expected exactly two candidates`)
    for (const [index, expected] of [keep, drop].entries()) {
      const { monster, record } = matches[index]
      assert.deepEqual([monster.sourcePath, monster.upstreamName, record], expected, `${where}: candidate changed`)
    }
    if (notesTo !== undefined) {
      const [correct, ...other] = candidates.get(notesTo) ?? []
      assert(correct && other.length === 0, `${where}: expected one existing ${notesTo} record`)
      assert.deepEqual(
        [correct.monster.sourcePath, correct.monster.upstreamName, correct.record],
        drop,
        `${where}: ${notesTo} record changed`,
      )
      for (const [language] of languages) {
        const text = matches[1].monster.notes[language]
        assert(
          text?.trim() && !Object.hasOwn(correct.monster.notes, language),
          `${where}: ${language} note keys changed (${id} → ${notesTo})`,
        )
        correct.monster.notes[language] = text
      }
    }
    candidates.set(id, [matches[0]])
  }
  const monsters = Array.from(candidates, ([id, matches]) => {
    assert(
      matches.length === 1,
      `Unregistered duplicate ID ${id}: ${matches.map(({ monster }) => monster.sourcePath).join(', ')}`,
    )
    return matches[0].monster
  })

  const floors = []
  for (const file of index.FloorData.filter((name) => name.startsWith('DD/'))) {
    const dungeon = dungeonFor(file)
    const redirects = yaml(file)
    const translations = localized(file)
    const byKey = new Map()
    for (const [language, entries] of translations) {
      for (const [key, text] of Object.entries(entries)) {
        assert(
          key.startsWith(dungeon) && integer(Number(key.slice(dungeon.length))),
          `${file}: invalid guide key ${key}`,
        )
        const floor = byKey.get(key) ?? { dungeon, key, notes: {} }
        floor.notes[language] = text
        byKey.set(key, floor)
      }
    }
    for (const [from, to] of Object.entries(redirects)) {
      const key = dungeon + from
      const redirect = dungeon + to
      assert(
        integer(Number(from)) && integer(to) && byKey.has(redirect) && !byKey.has(key),
        `${file}: invalid redirect ${key} → ${redirect}`,
      )
      floors.push({ dungeon, key, redirect, notes: {} })
    }
    floors.push(...byKey.values())
  }
  const territories = []
  for (const file of index.Territories) {
    for (const [group, ranges] of Object.entries(yaml(file))) {
      const dungeon = dungeonFor(group)
      assert(Array.isArray(ranges), `${file} ${group}: expected ranges`)
      for (const range of ranges) {
        assert(
          Array.isArray(range) && range.length === 2 && range.every(integer) && range[0] <= range[1],
          `${file} ${group}: invalid range ${range}`,
        )
        territories.push({ dungeon, first: range[0], last: range[1] })
      }
    }
  }
  return { catalog: { monsters, territories, floors, nameColumn: 0 }, files, sourceCount }
}

function build() {
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const vendor = 'vendor/monsterdex-data'
  const source = path.join(repo, vendor)
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const link = /^160000 ([a-f0-9]{40}) 0\s/.exec(git(repo, 'ls-files', '--stage', vendor))?.[1]
  assert(link, `Missing gitlink for ${vendor}`)
  assert.equal(
    git(source, 'rev-parse', 'HEAD'),
    link,
    `Initialize the pinned source with git submodule update --init ${vendor}`,
  )
  assert.equal(git(source, 'status', '--porcelain'), '', `${vendor}: source checkout has local changes`)
  const { catalog, files, sourceCount } = convertCatalog((file) => readFileSync(path.join(source, file), 'utf8'))
  const licenses = readdirSync(source).filter((file) => /^(?:LICENSE|COPYING|NOTICE)(?:\.|$)/i.test(file))
  const metadata = {
    source: 'https://github.com/wolfcomp/MonsterDex',
    branch: 'data',
    commit: link,
    sourceFiles: files,
    sourceMonsterCount: sourceCount,
    monsterCount: catalog.monsters.length,
    guideKeyCount: catalog.floors.filter((floor) => !floor.redirect).length,
    redirectCount: catalog.floors.filter((floor) => floor.redirect).length,
    fields: {
      monsters:
        'BNpcName ID, upstream name, dungeons, aggro, threat, five control resistances, undead, localized notes, source path',
      floors: 'dungeon, guide key, redirects, localized notes',
      territories: 'dungeon and inclusive territory range',
      nameColumn: 'zero-based BNpcName string column confirmed on China and Global clients',
    },
    overrides: overrides.map(({ id, keep, drop, notesTo, reason }) => ({
      id,
      keep: keep[0],
      drop: drop[0],
      notesTo,
      reason,
    })),
    credits:
      'MonsterDex by WildWolf and Strati; data credits include Maygi, the Deep Dungeon Compendium, and the Angelus community. Translations are contributed through Crowdin.',
    dataLicenseFiles: licenses.map((file) => `MonsterDex-data-${file}`),
    codeLicense: 'https://github.com/wolfcomp/MonsterDex/blob/7e0bc25c8a67b08f6d243e7a4c2a770bcadd96da/LICENSE',
    licenseScope: licenses.length
      ? 'Data license and notice files are reproduced as supplied. MonsterDex-code-MIT.txt is the separate upstream code license.'
      : 'The fixed data commit has no standalone license file. MonsterDex-code-MIT.txt is the upstream master code license, not a verified license grant for this data snapshot.',
  }
  const output = fileURLToPath(new URL('../src/generated/', import.meta.url))
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  for (const [file, value] of Object.entries({ 'catalog.json': catalog, 'monsterdex-source.json': metadata }))
    writeFileSync(path.join(output, file), `${JSON.stringify(value, null, 2)}\n`)
  for (const file of licenses)
    writeFileSync(path.join(output, `MonsterDex-data-${file}`), readFileSync(path.join(source, file)))
  console.log(
    `MonsterDex ${link}: ${sourceCount} source records → ${catalog.monsters.length} monsters, ${metadata.guideKeyCount} guides, ${metadata.redirectCount} redirects`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build()
