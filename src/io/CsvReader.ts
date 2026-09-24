import { DefaultDataset } from '../core/Dataset'
import type { Dataset } from '../core/Dataset'

export interface CsvReadOptions {
  separator?: '\t' | ','
  idColumn?: number   // which column is the row identifier (default: 0)
}

export interface ParseProgress {
  rowsRead: number
  totalRows: number
}

type ProgressCallback = (p: ParseProgress) => void

async function* readLines(file: File): AsyncGenerator<string> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      if (buffer.length > 0) yield buffer
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!
    for (const line of lines) {
      yield line
    }
  }
}

/**
 * Parse a tab-separated or comma-separated matrix file.
 * First row is treated as column headers; first column as row identifiers.
 * All remaining cells must be numeric (NaN for missing/non-numeric values).
 */
export async function parseCsv(
  file: File,
  options: CsvReadOptions = {},
  onProgress?: ProgressCallback
): Promise<Dataset> {
  const sep = options.separator ?? '\t'
  const idCol = options.idColumn ?? 0
  const lines = readLines(file)

  // Read header using .next() — breaking from for-await closes the generator,
  // which would silently drop all data rows.
  let headerLine = ''
  while (!headerLine) {
    const { done, value } = await lines.next()
    if (done) break
    headerLine = value.trim()
  }

  const headerParts = headerLine.split(sep)
  // Sample names: everything after the id column
  const sampleNames = headerParts.slice(idCol + 1)
  const nCols = sampleNames.length

  // Collect all data rows (we don't know nRows in advance for plain TSV)
  const rowIds: string[] = []
  const rows: number[][] = []

  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const parts = trimmed.split(sep)
    rowIds.push(parts[idCol] ?? '')
    const values: number[] = new Array(nCols)
    for (let j = 0; j < nCols; j++) {
      const raw = parts[idCol + 1 + j]
      values[j] = raw !== undefined && raw !== '' ? parseFloat(raw) : NaN
    }
    rows.push(values)
    onProgress?.({ rowsRead: rows.length, totalRows: rows.length })
  }

  const nRows = rows.length
  const dataset = new DefaultDataset(nRows, nCols, 'score')

  const rowIdVec = dataset.rowMetadata.addVector('id', 'string')
  const colIdVec = dataset.colMetadata.addVector('id', 'string')
  sampleNames.forEach((name, i) => { colIdVec.values[i] = name })

  for (let r = 0; r < nRows; r++) {
    rowIdVec.values[r] = rowIds[r]
    for (let c = 0; c < nCols; c++) {
      dataset.setValue(r, c, rows[r][c])
    }
  }

  return dataset
}
