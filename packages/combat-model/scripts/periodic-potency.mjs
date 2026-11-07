#!/usr/bin/env node

// Fills the potency tables of the periodic data, and writes the actions of each class and job into its file of
// ClassJobActions, from the game data.
//
// The script reads the descriptions of the actions in ActionTransient, evaluates their If macros for every level
// from 1 to the maxLevel of version.json with the job of the file, and writes the potency of every level where it
// changes. An action outside PvP goes into the file of each class and job that its ClassJobCategory names, with its
// category and attack type from the Action sheet, and the base, combo and positional potencies for that job when its
// description states nothing else about its potency; the calibration and the forced result the file gave it stay. The
// actions of no class or job, as those of the pets and those a crafter or gatherer may use, go nowhere. The statuses
// stay where the files put them. It prints the statuses whose description says they raise a potency and that the
// files and REVIEWED_STATUSES do not account for yet. It writes level-modifiers.json, the level modifiers of the
// critical and direct hit attributes at every level. Run `pnpm build` in this package first.
//
//   node scripts/periodic-potency.mjs --game <path> --defs src/defs

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { blackMageElements, gaugeModifiers } from '../dist/defs/ClassJobActions/BlackMage.js'
import { mergeClassJobActions, parsePeriodicDefs, SAMPLE_VARIANTS } from '../dist/defs.js'
import { evaluateSeString, Language, openExcel, renderText, SeStringMacroError } from './game-data.mjs'

const USAGE = `Usage: node scripts/periodic-potency.mjs --game <path> --defs <dir>

Reads version.json and ClassJobActions/*.json of the periodic data, and fills
the potency tables of every periodic status and calibration action from the
action descriptions of the game, for the class or job of the file. Rewrites the
actions of each file: those outside PvP that the ClassJobCategory of the Action
sheet gives the class or job, with their category and attack type, the
potencies that the potency samples use, and the calibration and forced result
the file gave them. Writes level-modifiers.json, the sub and div of every level
from the ParamGrow sheet. Nothing is written when an entry has no potency at a
level, when a file gives a calibration or a forced result to an action its class
or job does not have, when a file is not named after its class or job, or when
ParamGrow differs from the values of the wiki this script checks it against.

Prints the number of sample actions of each job, the files it creates, which
ClassJobActions/index.ts must list, and the statuses that raise a potency but
have neither a potencyBonus modifier in the files nor an entry in
REVIEWED_STATUSES of this script. Each of them goes into one of the two.

Options:
  --game <path>   The game directory of the client, which holds sqpack/ and ffxivgame.ver. Required.
  --defs <dir>    The directory of the periodic data, src/defs. Required.
  --help          Print this text.`

// The GlobalNumbers the descriptions read: the class or job, and the level
const JOB = 68
const LEVEL = 72
// The columns of Action; the ActionCategory and AttackType rows they point to are listed below
const ACTION_CATEGORY_COLUMN = 3
const CLASS_JOB_COLUMN = 10
const CLASS_JOB_LEVEL_COLUMN = 12
const ATTACK_TYPE_COLUMN = 44
const CLASS_JOB_CATEGORY_COLUMN = 50
const IS_PVP_COLUMN = 56
// The class a job starts from, as the marauder of the warrior
const CLASS_JOB_PARENT_COLUMN = 29
// The English name, which without its spaces names the file of the class or job
const CLASS_JOB_NAME_COLUMN = 30
const STATUS_DESCRIPTION_COLUMN = 1
const PARAM_GROW_SUB_COLUMN = 5
const PARAM_GROW_DIV_COLUMN = 6
/** The levels the wiki lists, to notice when the columns of ParamGrow move */
const KNOWN_LEVEL_MODIFIERS = new Map([
  [70, { sub: 364, div: 900 }],
  [80, { sub: 380, div: 1300 }],
  [90, { sub: 400, div: 1900 }],
  [100, { sub: 420, div: 2780 }],
])
const ACTION_CATEGORIES = new Map([
  [2, 'spell'],
  [3, 'weaponskill'],
  [4, 'ability'],
])
// -1 is the type of the weapon, which the physical actions have since 7.0; 0 is none, as most heals
const ATTACK_TYPES = new Map([
  [0, null],
  [-1, 'physical'],
  [1, 'slashing'],
  [2, 'piercing'],
  [3, 'blunt'],
  [4, 'shot'],
  [5, 'magic'],
  [6, 'darkness'],
])

/** The classes and jobs that have a file: the paladin to the beastmaster */
const FILE_CLASS_JOBS = Array.from({ length: 25 }, (_, index) => 19 + index)
/** The crafters and gatherers; an action one of them may use, as Sprint, belongs to no file */
const CRAFTERS_GATHERERS = Array.from({ length: 11 }, (_, index) => 8 + index)
/** The combat jobs, without the blue mage, a limited job */
const SAMPLE_JOBS = Array.from({ length: 24 }, (_, index) => 19 + index).filter((job) => job !== 36)
/** How a description states the potencies that a sample tells apart by the bonus percentage of the hit */
const SAMPLE_LABELS = new Map([
  ['威力', 'base'],
  ['连击中威力', 'combo'],
  ['背面攻击威力', 'rear'],
  ['侧面攻击威力', 'flank'],
  ['连击中背面攻击威力', 'comboRear'],
  ['连击中侧面攻击威力', 'comboFlank'],
])
/** The potency of the targets after the first, which no sample is; new wordings go here */
const NON_FIRST_TARGET = ['对目标之外的敌人威力降低', '对第一个之外的敌人威力降低']
const FORCED_TEXT = ['必定暴击', '必定直击']
/** With 威力, the words of a text that raises a potency */
const RAISE_WORDS = ['提升', '提高', '增加', '上升']

/** Why a status that raises a potency needs no potencyBonus modifier; no other reason is allowed */
const REVIEW = {
  gauge: 'ClassJobActions/BlackMage.ts gives the change of the potency',
  blueMage: 'a status of the blue mage',
  pvp: 'a status of PvP',
  healing: 'the potency is that of heals',
  multiplier: 'a file has a multiplier for it, which the samples are divided by',
  unused: 'no PvE action of a player applies it in this version',
}

/** Status ID → why it needs no potencyBonus modifier */
const REVIEWED_STATUSES = new Map([
  [173, REVIEW.gauge],
  [174, REVIEW.gauge],
  [175, REVIEW.gauge],
  [176, REVIEW.gauge],
  [177, REVIEW.gauge],
  [178, REVIEW.gauge],
  [187, REVIEW.unused],
  [351, REVIEW.unused],
  [575, REVIEW.unused],
  [593, REVIEW.unused],
  [736, REVIEW.unused],
  [856, REVIEW.unused],
  [857, REVIEW.unused],
  [1303, REVIEW.pvp],
  [1786, REVIEW.unused],
  [1861, REVIEW.unused],
  [2118, REVIEW.blueMage],
  [2130, REVIEW.blueMage],
  [2492, REVIEW.unused],
  [2960, REVIEW.unused],
  [3045, REVIEW.pvp],
  [3641, REVIEW.blueMage],
])

class UsageError extends Error {}

/** Reads the command line, rejecting anything it does not understand. */
function parseArguments(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        game: { type: 'string' },
        defs: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    throw new UsageError(error.message)
  }
  const { values } = parsed
  if (values.help) return { help: true }
  for (const option of ['game', 'defs']) {
    if (values[option] === undefined) throw new UsageError(`--${option} is required`)
  }
  return { help: false, game: values.game, defs: values.defs }
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf-8'))

const isFlat = (value) =>
  typeof value !== 'object' ||
  value === null ||
  Object.values(value).every((item) => typeof item !== 'object' || item === null)

const LINE_WIDTH = 120

const inlineJson = (value) =>
  isFlat(value) && !Array.isArray(value) && typeof value === 'object' && value !== null
    ? `{ ${Object.entries(value)
        .map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`)
        .join(', ')} }`
    : JSON.stringify(value)

/**
 * JSON as the formatter of the repository writes it: two spaces of indent, a flat object on one line, and an array of
 * plain values or flat objects on one line when it fits.
 * @param used The width the line has besides the value: the text before it, and the comma after it
 */
function formatJson(value, indent = '', used = 0) {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value)
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every(isFlat)) {
      const line = `[${value.map(inlineJson).join(', ')}]`
      if (used + line.length <= LINE_WIDTH) return line
    }
    const items = value.map(
      (item, index) => inner + formatJson(item, inner, inner.length + (index < value.length - 1 ? 1 : 0)),
    )
    return `[\n${items.join(',\n')}\n${indent}]`
  }
  if (isFlat(value)) return inlineJson(value)
  const entries = Object.entries(value)
  const members = entries.map(([key, item], index) => {
    const head = `${inner}${JSON.stringify(key)}: `
    return head + formatJson(item, inner, head.length + (index < entries.length - 1 ? 1 : 0))
  })
  return `{\n${members.join(',\n')}\n${indent}}`
}

/**
 * The number after the first of the markers in the text: the first "威力：N" after "持续伤害", for example.
 * @returns null when the text has no such number
 */
function numberAfter(text, starts, label) {
  const found = starts.map((start) => text.indexOf(start)).filter((at) => at >= 0)
  if (starts.length && found.length === 0) return null
  const from = starts.length ? Math.min(...found) : 0
  const match = new RegExp(`${label}：(\\d+)`).exec(text.slice(from))
  return match ? Number(match[1]) : null
}

/** How to find the potency in a description; the poison of the bards is written as 中毒 */
const markers = {
  periodicdamage: [['持续伤害', '中毒'], '威力'],
  periodicheal: [['持续恢复'], '恢复力'],
  calibrationdamage: [[], '威力'],
  calibrationheal: [[], '恢复力'],
}

/**
 * The potency of every level from 1 to maxLevel, as a table of the levels where it changes. A trait may add the
 * effect at a level: the levels before the first potency take it, as the status does not exist there.
 * @returns The table, or the first level without a potency after one had it
 */
function potencyTable(description, job, maxLevel, [starts, label]) {
  const table = []
  let leading = 0
  for (let level = 1; level <= maxLevel; level++) {
    const text = renderText(
      evaluateSeString(
        description,
        new Map([
          [JOB, job],
          [LEVEL, level],
        ]),
      ),
    )
    const potency = numberAfter(text, starts, label)
    if (potency === null) {
      if (table.length) return { missing: level, text }
      leading = level
      continue
    }
    if (table.length === 0) table.push({ level: 1, potency })
    else if (table.at(-1).potency !== potency) table.push({ level, potency })
  }
  if (table.length === 0) return { missing: leading, text: '' }
  return { table, from: leading + 1 }
}

/**
 * The potencies a description states, by their keys in the potency of an action.
 * @returns Why the action is left out, when the description says anything else about the potency or forces the hit
 */
function samplePotencies(text) {
  if (FORCED_TEXT.some((word) => text.includes(word))) return { excluded: 'forced' }
  let rest = text
  for (const phrase of NON_FIRST_TARGET) rest = rest.replaceAll(phrase, '')
  const potency = {}
  for (let at = rest.indexOf('威力'); at >= 0; at = rest.indexOf('威力', at + 2)) {
    // A label starts a line, or follows the full-width space after the text before it
    const start = Math.max(rest.lastIndexOf('\n', at), rest.lastIndexOf('　', at)) + 1
    const key = SAMPLE_LABELS.get(rest.slice(start, at + 2))
    // A range, as 威力：720～1000, is not a potency of its own
    const match = /^：(\d+)(?![\d～~])/.exec(rest.slice(at + 2))
    if (!key || !match) return { excluded: 'text' }
    const value = Number(match[1])
    if (potency[key] !== undefined && potency[key] !== value) return { excluded: 'text' }
    potency[key] = value
  }
  return { potency }
}

/**
 * A table of the levels where the potency changes; the levels before the first potency take it.
 * @returns null when a level after the first potency has none
 */
function levelTable(values) {
  const first = values.findIndex((value) => value !== null)
  const table = []
  for (const [index, value] of values.entries()) {
    if (index < first) continue
    if (value === null) return null
    if (table.length === 0) table.push({ level: 1, potency: value })
    else if (table.at(-1).potency !== value) table.push({ level: index + 1, potency: value })
  }
  return table
}

const textAt = (description, job, level) =>
  renderText(
    evaluateSeString(
      description,
      new Map([
        [JOB, job],
        [LEVEL, level],
      ]),
    ),
  )

/** Whether a line of another action of the job raises the potency of the action by name, as 龙颚正拳的威力提升200 */
const raisedByOther = (name, otherLines) =>
  otherLines.some((lines) =>
    lines.some(
      (line) => line.includes(name) && line.includes('威力') && RAISE_WORDS.some((word) => line.includes(word)),
    ),
  )

/** The description of the action, column 0 of ActionTransient */
async function actionDescription(excel, id) {
  const description = (await excel.readRow('ActionTransient', id, Language.ChineseSimplified))[0]
  if (!Array.isArray(description)) throw new Error(`Column 0 of ActionTransient ${id} is not a string`)
  return description
}

/**
 * The classes and jobs with a file that the ClassJobCategory of the action names. None for an action without one, as
 * those of the pets, or one that a crafter or gatherer may also use.
 * @param categories ClassJobCategory ID → its row, filled as the rows are read
 */
async function classJobsOf(excel, row, categories) {
  const id = row[CLASS_JOB_CATEGORY_COLUMN]
  if (id === 0) return []
  if (!categories.has(id)) categories.set(id, await excel.readRow('ClassJobCategory', id, Language.ChineseSimplified))
  // Column 0 is the name; that of a class or job is its ID plus 1
  const category = categories.get(id)
  if (CRAFTERS_GATHERERS.some((classJob) => category[classJob + 1] === true)) return []
  return FILE_CLASS_JOBS.filter((classJob) => category[classJob + 1] === true)
}

/**
 * The sample actions: the spells, weaponskills and abilities outside PvP of a combat job or of the class it starts
 * from, once for each job that uses them and that their ClassJobCategory names: a scholar has no sample of an action of
 * the arcanist it does not learn.
 * @returns The sample actions with their job, and the number of entries written and left out by job
 */
async function sampleActionsOf(excel, maxLevel, categories) {
  const parents = new Map()
  for (const job of SAMPLE_JOBS) {
    parents.set(job, (await excel.readRow('ClassJob', job, Language.ChineseSimplified))[CLASS_JOB_PARENT_COLUMN])
  }
  const candidates = []
  for (const id of await excel.rowIds('Action', Language.ChineseSimplified)) {
    const row = await excel.readRow('Action', id, Language.ChineseSimplified)
    const classJob = row[CLASS_JOB_COLUMN]
    if (!ACTION_CATEGORIES.has(row[ACTION_CATEGORY_COLUMN]) || row[IS_PVP_COLUMN] === true || !(classJob > 0)) continue
    const users = await classJobsOf(excel, row, categories)
    const jobs = SAMPLE_JOBS.filter((job) => (job === classJob || parents.get(job) === classJob) && users.includes(job))
    if (jobs.length === 0) continue
    const description = await actionDescription(excel, id)
    for (const job of jobs) {
      const texts = Array.from({ length: maxLevel }, (_, index) => textAt(description, job, index + 1))
      const lines = [...new Set(texts.flatMap((text) => text.split(/\r?\n/)))]
      candidates.push({ id, job, name: renderText(row[0]), texts, lines })
    }
  }

  const entries = []
  const counts = new Map(SAMPLE_JOBS.map((job) => [job, { written: 0, excluded: 0 }]))
  for (const candidate of candidates) {
    const { id, job, name, texts } = candidate
    // An action without a potency is neither a sample action nor left out
    if (!texts.some((text) => text.includes('威力'))) continue
    const count = counts.get(job)
    const otherLines = candidates
      .filter((other) => other.job === job && other !== candidate)
      .map((other) => other.lines)
    const levels = texts.map(samplePotencies)
    if (levels.some((level) => level.excluded) || raisedByOther(name, otherLines)) {
      count.excluded++
      continue
    }
    const potency = {}
    for (const key of ['base', ...SAMPLE_VARIANTS]) {
      const values = levels.map((level) => level.potency[key] ?? null)
      if (values.some((value) => value !== null)) potency[key] = levelTable(values)
    }
    if (!potency.base || Object.values(potency).includes(null)) {
      count.excluded++
      continue
    }
    entries.push({ id, job, potency })
    count.written++
  }
  entries.sort((a, b) => a.id - b.id || a.job - b.job)
  return { entries, counts }
}

/**
 * The statuses whose description raises a potency for any combat job at maxLevel, that have no potencyBonus modifier
 * in the files and are not in REVIEWED_STATUSES
 */
async function pendingStatuses(excel, statuses, maxLevel) {
  const marked = new Set(
    statuses
      .filter((entry) => (entry.modifiers ?? []).some((modifier) => modifier.type === 'potencyBonus'))
      .map((entry) => entry.id),
  )
  const pending = []
  for (const id of await excel.rowIds('Status', Language.ChineseSimplified)) {
    if (marked.has(id) || REVIEWED_STATUSES.has(id)) continue
    const row = await excel.readRow('Status', id, Language.ChineseSimplified)
    const description = row[STATUS_DESCRIPTION_COLUMN]
    // The names of actions in the description depend on the job and the level. A description that reads other
    // GlobalNumbers, as the level of a gatherer, is searched with all of its branches.
    const textOf = (job) => {
      try {
        return textAt(description, job, maxLevel)
      } catch (error) {
        if (error instanceof SeStringMacroError) return renderText(description)
        throw error
      }
    }
    const texts = new Set(SAMPLE_JOBS.map(textOf))
    const raising = [...texts].filter(
      (text) => text.includes('威力') && RAISE_WORDS.some((word) => text.includes(word)),
    )
    if (raising.length) pending.push({ id, name: renderText(row[0]), texts: raising })
  }
  return pending
}

/** The fields of an action that only its file gives, which the script keeps when it rewrites the actions */
const KEPT_FIELDS = ['calibration', 'forced']

/** The files of ClassJobActions, by name, each with its name without .json and its content */
async function readClassJobFiles(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
  return Promise.all(
    names.map(async (name) => ({
      name: name.slice(0, -'.json'.length),
      content: await readJson(join(directory, name)),
    })),
  )
}

/** The input of mergeClassJobActions, with the names the model gives the files */
const classJobActionsFiles = (files) => files.map(({ name, content }) => ({ name: `ClassJobActions/${name}`, content }))

/**
 * The actions of a class or job as its file lists them: those the game gives it, with the fields of KEPT_FIELDS its
 * file gave them and their sample potencies
 * @param types The category and the attack type of each action of the class or job, by ascending ID
 * @param given The actions of the file
 * @param samples The sample actions of the class or job
 * @param where The file, for the errors
 */
function rewriteActions(types, given, samples, where, errors) {
  const kept = new Map(
    given.filter((entry) => KEPT_FIELDS.some((field) => entry[field] !== undefined)).map((entry) => [entry.id, entry]),
  )
  const potencies = new Map(samples.map(({ id, potency }) => [id, potency]))
  const actions = types.map(({ id, category, attackType }) => {
    const action = { id, category, attackType }
    const entry = kept.get(id)
    kept.delete(id)
    for (const field of KEPT_FIELDS) if (entry?.[field] !== undefined) action[field] = entry[field]
    const potency = potencies.get(id)
    potencies.delete(id)
    if (potency) action.potency = potency
    return action
  })
  for (const [id, entry] of kept) {
    const fields = KEPT_FIELDS.filter((field) => entry[field] !== undefined).join(', ')
    errors.push(`${where}: action ${id} has ${fields}, but the class or job does not have it`)
  }
  for (const id of potencies.keys()) errors.push(`${where}: sample action ${id} is not an action of the class or job`)
  return actions
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }

  const paths = {
    version: join(options.defs, 'version.json'),
    levelModifiers: join(options.defs, 'level-modifiers.json'),
    classJobActions: join(options.defs, 'ClassJobActions'),
  }
  const version = await readJson(paths.version)
  const files = await readClassJobFiles(paths.classJobActions)
  // Checks every field the script does not fill
  const defs = parsePeriodicDefs(
    {
      version,
      ...mergeClassJobActions(classJobActionsFiles(files)),
      levelModifiers: { levels: [] },
      gauge: gaugeModifiers,
      elements: blackMageElements,
    },
    { requirePotency: false },
  )

  const gameVersion = (await readFile(join(options.game, 'ffxivgame.ver'), 'utf-8')).trim()
  if (gameVersion !== defs.gameVersion) {
    throw new Error(`the game is version ${gameVersion}, the periodic data is for ${defs.gameVersion}`)
  }

  const excel = await openExcel(options.game)
  const errors = []
  const notes = []
  /** Class or job → the name of its file */
  const fileNames = new Map()
  /** Class or job → the category and the attack type of its actions */
  const actionTypes = new Map(FILE_CLASS_JOBS.map((classJob) => [classJob, []]))
  /** The actions of no class or job, which no file lists */
  let unowned = 0
  const categories = new Map()
  const levelModifiers = { levels: [] }
  let samples
  let pending
  try {
    for (const classJob of FILE_CLASS_JOBS) {
      const row = await excel.readRow('ClassJob', classJob, Language.ChineseSimplified)
      fileNames.set(classJob, renderText(row[CLASS_JOB_NAME_COLUMN]).replaceAll(' ', ''))
    }
    for (const { name, content } of files) {
      const expected = fileNames.get(content.classJob)
      if (expected === undefined) {
        errors.push(`ClassJobActions/${name}.json: class or job ${content.classJob} has no file`)
      } else if (expected !== name) {
        errors.push(`ClassJobActions/${name}.json: class or job ${content.classJob} is named ${expected}`)
      }
    }

    // The spells, weaponskills and abilities outside PvP that a class or job learns, or that have a level: the pets
    // have it
    for (const id of await excel.rowIds('Action', Language.ChineseSimplified)) {
      const row = await excel.readRow('Action', id, Language.ChineseSimplified)
      const category = ACTION_CATEGORIES.get(row[ACTION_CATEGORY_COLUMN])
      if (!category || row[IS_PVP_COLUMN] === true) continue
      if (!(row[CLASS_JOB_COLUMN] > 0 || row[CLASS_JOB_LEVEL_COLUMN] > 0)) continue
      const attackType = ATTACK_TYPES.get(row[ATTACK_TYPE_COLUMN])
      if (attackType === undefined) errors.push(`action types: action ${id} has AttackType ${row[ATTACK_TYPE_COLUMN]}`)
      const classJobs = await classJobsOf(excel, row, categories)
      if (classJobs.length === 0) unowned++
      for (const classJob of classJobs) actionTypes.get(classJob).push({ id, category, attackType })
    }
    const tableOf = async (id, job, marker, where) => {
      const result = potencyTable(await actionDescription(excel, id), job, defs.maxLevel, marker)
      if (result.missing) {
        errors.push(
          `${where}: action ${id} has no potency at level ${result.missing}: ${result.text.replace(/\n/g, ' ')}`,
        )
      } else if (result.from > 1) {
        notes.push(`${where}: action ${id} states the potency from level ${result.from}`)
      }
      return result.table
    }

    for (const { name, content } of files) {
      const job = content.classJob
      for (const [index, entry] of content.statuses.entries()) {
        if (!entry.periodic) continue
        const where = `ClassJobActions/${name}.statuses[${index}].periodic`
        const { kind, action } = entry.periodic
        const potency = await tableOf(action, job, markers[`periodic${kind}`], where)
        entry.periodic = { kind, action, potency }
      }
      for (const [index, entry] of content.actions.entries()) {
        if (!entry.calibration) continue
        const where = `ClassJobActions/${name}.actions[${index}].calibration`
        const { kind, gauge } = entry.calibration
        const potency = await tableOf(entry.id, job, markers[`calibration${kind}`], where)
        entry.calibration = gauge ? { kind, potency, gauge } : { kind, potency }
      }
    }

    samples = await sampleActionsOf(excel, defs.maxLevel, categories)
    pending = await pendingStatuses(
      excel,
      files.flatMap(({ content }) => content.statuses),
      defs.maxLevel,
    )

    for (let level = 1; level <= defs.maxLevel; level++) {
      const row = await excel.readRow('ParamGrow', level, Language.None)
      const sub = row[PARAM_GROW_SUB_COLUMN]
      const div = row[PARAM_GROW_DIV_COLUMN]
      const known = KNOWN_LEVEL_MODIFIERS.get(level)
      if (known && (known.sub !== sub || known.div !== div)) {
        errors.push(
          `level-modifiers: level ${level} has sub ${sub} and div ${div}, the wiki has ${known.sub} and ${known.div}`,
        )
      }
      levelModifiers.levels.push({ level, sub, div })
    }
  } finally {
    await excel.close()
  }

  const samplesOf = new Map(FILE_CLASS_JOBS.map((classJob) => [classJob, []]))
  for (const { id, job, potency } of samples.entries) samplesOf.get(job).push({ id, potency })
  const byClassJob = new Map(files.map((file) => [file.content.classJob, file]))
  const created = []
  const outputs = FILE_CLASS_JOBS.map((classJob) => {
    const file = byClassJob.get(classJob)
    const name = fileNames.get(classJob)
    if (!file) created.push(name)
    const where = `ClassJobActions/${file?.name ?? name}.json`
    const given = file?.content.actions ?? []
    const actions = rewriteActions(actionTypes.get(classJob), given, samplesOf.get(classJob), where, errors)
    return { name, content: { classJob, statuses: file?.content.statuses ?? [], actions } }
  })

  for (const note of notes) console.log(note)
  if (errors.length) {
    for (const error of errors) console.error(error)
    throw new Error(`${errors.length} entries could not be filled, nothing is written`)
  }

  // The result must pass the check the model does when it loads
  parsePeriodicDefs({
    version,
    ...mergeClassJobActions(classJobActionsFiles(outputs)),
    levelModifiers,
    gauge: gaugeModifiers,
    elements: blackMageElements,
  })
  for (const { name, content } of outputs) {
    await writeFile(join(paths.classJobActions, `${name}.json`), `${formatJson(content)}\n`)
  }
  await writeFile(paths.levelModifiers, `${formatJson(levelModifiers)}\n`)
  const calibrations = [...defs.calibration.values()].flat().length
  const listed = [...actionTypes.values()].reduce((sum, list) => sum + list.length, 0)
  console.log(
    `filled ${defs.periodic.size} periodic statuses and ${calibrations} calibrations, listed ${listed} actions of ` +
      `the classes and jobs, and left out ${unowned} actions of no class or job`,
  )
  for (const name of created)
    console.log(`created ClassJobActions/${name}.json, which ClassJobActions/index.ts must list`)
  for (const [job, { written, excluded }] of samples.counts) {
    console.log(`job ${job}: ${written} sample actions, ${excluded} left out`)
  }
  for (const { id, name, texts } of pending) {
    const text = texts.map((item) => item.replace(/\r?\n/g, ' ')).join(' | ')
    console.log(`status ${id} ${name} raises a potency: ${text}`)
  }
  if (pending.length) console.log(`${pending.length} statuses need a potencyBonus modifier or a review`)
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(error.message)
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
