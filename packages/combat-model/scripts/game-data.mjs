// The parts of the game data periodic-potency.mjs reads: the rows of the sheets without subrows, and the If macros
// and the text of their strings.

import {
  BinaryExpressionComparison,
  ExpressionType,
  formatSeString,
  ParameterType,
  parseSeString,
  Type,
} from '@ffcafe/elpis-sestring'
import {
  EXDReader,
  ExcelVariant,
  GameSqPackReader,
  getExdPath,
  Language,
  readExhHeader,
  readExlFile,
} from '@ffcafe/elpis-sqpack'

export { Language }

/**
 * Opens the sheets of a game directory. String cells are parsed into SeString; other cells keep their type.
 * @param gamePath The game directory of the client, the one that holds `sqpack/`
 * @throws When `exd/root.exl` is not found
 */
export async function openExcel(gamePath) {
  const reader = new GameSqPackReader(gamePath)
  const read = async (path) => {
    const data = await reader.readFile(path)
    if (!data) throw new Error(`${path} is not found in ${gamePath}`)
    return data
  }
  let sheets
  try {
    sheets = new Set(readExlFile(await read('exd/root.exl')).entries.map((entry) => entry.name))
  } catch (error) {
    await reader.close()
    throw error
  }
  const headers = new Map()
  const pages = new Map()
  const headerOf = async (sheet, language) => {
    if (!sheets.has(sheet)) throw new Error(`Sheet ${sheet} is not listed in exd/root.exl`)
    if (!headers.has(sheet)) headers.set(sheet, readExhHeader(await read(`exd/${sheet}.exh`)))
    const header = headers.get(sheet)
    if (header.variant !== ExcelVariant.Default) throw new Error(`Sheet ${sheet} has subrows`)
    if (!header.languages.includes(language))
      throw new Error(`Sheet ${sheet} does not support language ${Language[language]}`)
    return header
  }
  const pageOf = async (sheet, startId, language, header) => {
    const path = getExdPath(sheet, startId, language)
    if (!pages.has(path)) pages.set(path, new EXDReader(await read(path), header))
    return pages.get(path)
  }
  return {
    /** The IDs of the rows of the sheet in ascending order */
    async rowIds(sheet, language) {
      const header = await headerOf(sheet, language)
      const ids = []
      for (const { startId } of header.paginations)
        ids.push(...(await pageOf(sheet, startId, language, header)).listRowIds())
      return ids.sort((a, b) => a - b)
    },
    /** Every cell of the row */
    async readRow(sheet, rowId, language) {
      const header = await headerOf(sheet, language)
      const pagination = header.paginations.find(
        ({ startId, rowCount }) => startId <= rowId && rowId < startId + rowCount,
      )
      if (!pagination) throw new Error(`Row ${rowId} of ${sheet} is not found`)
      const page = await pageOf(sheet, pagination.startId, language, header)
      let values
      try {
        values = page.readRow(rowId)
      } catch (error) {
        throw new Error(`Row ${rowId} of ${sheet} is not found`, { cause: error })
      }
      return values.map((value) => (value instanceof Uint8Array ? parseSeString(value) : value))
    },
    async close() {
      await reader.close()
    },
  }
}

/** A macro of a SeString cannot be evaluated with the values given */
export class SeStringMacroError extends Error {
  name = 'SeStringMacroError'
}

const compare = {
  [BinaryExpressionComparison.GreaterThanOrEqualTo]: (left, right) => left >= right,
  [BinaryExpressionComparison.GreaterThan]: (left, right) => left > right,
  [BinaryExpressionComparison.LessThanOrEqualTo]: (left, right) => left <= right,
  [BinaryExpressionComparison.LessThan]: (left, right) => left < right,
  [BinaryExpressionComparison.Equal]: (left, right) => left === right,
  [BinaryExpressionComparison.NotEqual]: (left, right) => left !== right,
}

/** An integer or a GlobalNumber */
function evaluateNumber(expression, globalNumbers) {
  if (expression.type === ExpressionType.Integer) return expression.value
  if (expression.type === ExpressionType.Parameter && expression.kind === ParameterType.GlobalNumber) {
    const value = globalNumbers.get(expression.value)
    if (value === undefined) throw new SeStringMacroError(`GlobalNumber ${expression.value} has no value`)
    return value
  }
  throw new SeStringMacroError(`expected an integer or a GlobalNumber, got expression type ${expression.type}`)
}

function evaluateCondition(expression, globalNumbers) {
  if (expression.type === ExpressionType.Binary)
    return compare[expression.comparison](
      evaluateNumber(expression.left, globalNumbers),
      evaluateNumber(expression.right, globalNumbers),
    )
  return evaluateNumber(expression, globalNumbers) !== 0
}

/** The text a branch of an If stands for; a branch the macro leaves out is empty */
function evaluateBranch(expression, globalNumbers) {
  if (expression === undefined) return []
  if (expression.type === ExpressionType.String) return evaluateSeString(expression.value, globalNumbers)
  if (expression.type === ExpressionType.Integer) return [String(expression.value)]
  throw new SeStringMacroError(`a branch of If must be a string or an integer, got expression type ${expression.type}`)
}

/**
 * Replaces every If macro with the branch its condition picks, in the branches too; other macros stay.
 * @param globalNumbers The values of the GlobalNumbers by their index
 * @throws SeStringMacroError when a condition reads something other than integers and GlobalNumbers, or a
 *   GlobalNumber without a value
 */
export function evaluateSeString(value, globalNumbers) {
  const result = []
  for (const part of value) {
    if (typeof part === 'string' || part.type !== Type.If) {
      result.push(part)
      continue
    }
    const [condition, then, otherwise] = part.data
    if (condition === undefined) throw new SeStringMacroError('an If has no condition')
    result.push(...evaluateBranch(evaluateCondition(condition, globalNumbers) ? then : otherwise, globalNumbers))
  }
  return result
}

/** A SeString as plain text, without colours and other tags */
export function renderText(value) {
  return formatSeString(value, { renderToText: true })
}
