import { DefaultDataset } from '../core/Dataset'
import type { Dataset } from '../core/Dataset'

export interface ParseProgress {
  phase: 1 | 2
  linesRead: number
  totalLines: number   // -1 until known
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
    for (const line of lines) yield line
  }
}

function stripQuotes(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
}

/**
 * Parse a Gitools TDM (Tab-Delimited Matrix) file.
 *
 * Format: long/melted layout — one row per cell.
 * Header:  "column"\t"row"\t"Series1"\t"Series2"\t...
 * Data:    col_id\trow_id\tval_or_dash\t...
 *
 * Missing values are encoded as "-". Cells absent from the file are NaN.
 * Uses two streaming passes: pass 1 discovers dimensions, pass 2 fills arrays.
 */
export async function parseTdm(file: File, onProgress?: ProgressCallback): Promise<Dataset> {
  // ── Pass 1: collect unique column and row IDs ─────────────────────────────
  const colMap = new Map<string, number>()
  const rowMap = new Map<string, number>()
  let seriesNames: string[] = []
  let totalDataLines = 0
  let firstLine = true

  for await (const line of readLines(file)) {
    if (firstLine) {
      const parts = line.split('\t')
      // parts[0]="column", parts[1]="row", parts[2..] = series names
      seriesNames = parts.slice(2).map(stripQuotes)
      firstLine = false
      continue
    }
    if (line.trim() === '') continue

    // Fast extraction of the two ID fields without a full split
    const t1 = line.indexOf('\t')
    const t2 = line.indexOf('\t', t1 + 1)
    const colId = line.slice(0, t1)
    const rowId = line.slice(t1 + 1, t2)

    if (!colMap.has(colId)) colMap.set(colId, colMap.size)
    if (!rowMap.has(rowId)) rowMap.set(rowId, rowMap.size)

    totalDataLines++
    if (totalDataLines % 100_000 === 0) {
      onProgress?.({ phase: 1, linesRead: totalDataLines, totalLines: -1 })
    }
  }

  const nCols    = colMap.size
  const nRows    = rowMap.size
  const nSeries  = seriesNames.length

  if (nCols === 0 || nRows === 0 || nSeries === 0) {
    throw new Error('TDM file appears empty or has no series columns.')
  }

  // ── Allocate dataset ──────────────────────────────────────────────────────
  const dataset = new DefaultDataset(nRows, nCols, seriesNames[0])
  for (let s = 1; s < nSeries; s++) dataset.addSeries(seriesNames[s])

  // Sparse format: cells absent from the file must be NaN, not 0
  for (let s = 0; s < nSeries; s++) dataset.getSeriesArray(s).fill(NaN)

  const rowIdVec = dataset.rowMetadata.addVector('id', 'string')
  const colIdVec = dataset.colMetadata.addVector('id', 'string')
  for (const [id, i] of colMap) colIdVec.values[i] = id
  for (const [id, i] of rowMap) rowIdVec.values[i] = id

  // ── Pass 2: fill values ────────────────────────────────────────────────────
  let dataLine = 0
  firstLine = true

  for await (const line of readLines(file)) {
    if (firstLine) { firstLine = false; continue }  // skip header
    if (line.trim() === '') continue

    const parts = line.split('\t')
    const colIdx = colMap.get(parts[0])
    const rowIdx = rowMap.get(parts[1])

    // Skip lines whose IDs we somehow didn't see in pass 1 (should never happen)
    if (colIdx === undefined || rowIdx === undefined) continue

    for (let s = 0; s < nSeries; s++) {
      const raw = parts[2 + s]
      dataset.setValue(rowIdx, colIdx, (raw === undefined || raw === '-' || raw === '') ? NaN : parseFloat(raw), s)
    }

    dataLine++
    if (dataLine % 100_000 === 0) {
      onProgress?.({ phase: 2, linesRead: dataLine, totalLines: totalDataLines })
    }
  }

  return dataset
}
