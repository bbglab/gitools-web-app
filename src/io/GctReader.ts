// Portions derived from Morpheus.js
// Copyright (c) 2017, Connectivity Map and LINCS at the Broad Institute
// BSD 3-Clause License — see LICENSE.morpheus in the project root

import { DefaultDataset } from '../core/Dataset'
import type { Dataset } from '../core/Dataset'

export interface ParseProgress {
  rowsRead: number
  totalRows: number
}

type ProgressCallback = (p: ParseProgress) => void

/**
 * Streaming line reader over a File using ReadableStream.
 * Never loads the entire file into memory at once.
 */
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
 * Parse GCT v1.2 or v1.3.
 *
 * v1.2: single data matrix, first two annotation columns are Name + Description.
 * v1.3: multi-series, arbitrary row/col metadata columns.
 */
export async function parseGct(file: File, onProgress?: ProgressCallback): Promise<Dataset> {
  const lines = readLines(file)

  const versionLine = (await lines.next()).value?.trim() ?? ''
  if (!versionLine.startsWith('#1.')) {
    throw new Error(`Not a GCT file (first line: "${versionLine}")`)
  }
  const version = versionLine  // '#1.2' or '#1.3'

  const dimLine = (await lines.next()).value?.trim() ?? ''
  const dimParts = dimLine.split('\t')

  const nRows = parseInt(dimParts[0], 10)
  const nCols = parseInt(dimParts[1], 10)
  const nRowMeta = version === '#1.3' ? parseInt(dimParts[2] ?? '0', 10) : 1  // Name col only for v1.2
  const nColMeta = version === '#1.3' ? parseInt(dimParts[3] ?? '0', 10) : 0

  if (isNaN(nRows) || isNaN(nCols)) {
    throw new Error(`Invalid GCT dimensions: "${dimLine}"`)
  }

  // --- v1.3: read column metadata rows ---
  const colMetaHeaders: string[] = []
  const colMetaValues: string[][] = []  // [metaFieldIndex][colIndex]

  if (version === '#1.3' && nColMeta > 0) {
    // Header row for column metadata
    const headerLine = (await lines.next()).value ?? ''
    const headerParts = headerLine.split('\t')
    // First (1 + nRowMeta) fields are row metadata headers; rest are col names
    for (let m = 1 + nRowMeta; m < headerParts.length; m++) {
      colMetaHeaders.push(headerParts[m])
    }

    for (let ci = 0; ci < nColMeta; ci++) {
      const line = (await lines.next()).value ?? ''
      const parts = line.split('\t')
      const vals: string[] = []
      for (let m = 1 + nRowMeta; m < parts.length; m++) {
        vals.push(parts[m])
      }
      colMetaValues.push(vals)
    }
  }

  // --- Header row (column names) ---
  const headerLine = (await lines.next()).value ?? ''
  const headerParts = headerLine.split('\t')

  // Column names start after the row-metadata columns
  const colNameOffset = version === '#1.3' ? 1 + nRowMeta : 2  // v1.2: Name + Description
  const sampleNames: string[] = headerParts.slice(colNameOffset)

  if (sampleNames.length !== nCols) {
    throw new Error(
      `Header has ${sampleNames.length} sample columns but dimensions say ${nCols}`
    )
  }

  // Row metadata field names (everything between id and data columns in header)
  const rowMetaNames: string[] =
    version === '#1.3'
      ? headerParts.slice(1, 1 + nRowMeta)
      : ['Description']

  // --- Build Dataset ---
  // For v1.3 the first series name comes from the header; for v1.2 use 'score'
  const seriesName = version === '#1.3' ? (headerParts[0] ?? 'score') : 'score'
  const dataset = new DefaultDataset(nRows, nCols, seriesName)

  // Add row metadata vectors
  const rowVectors = rowMetaNames.map(name =>
    dataset.rowMetadata.addVector(name, 'string')
  )

  // Add column metadata
  const idVector = dataset.colMetadata.addVector('id', 'string')
  sampleNames.forEach((name, i) => { idVector.values[i] = name })

  for (let ci = 0; ci < colMetaHeaders.length; ci++) {
    const v = dataset.colMetadata.addVector(colMetaHeaders[ci], 'string')
    colMetaValues[ci].forEach((val, i) => { v.values[i] = val })
  }

  // Row id vector
  const rowIdVector = dataset.rowMetadata.addVector('id', 'string')

  // --- Read data rows ---
  let rowIndex = 0
  for await (const line of lines) {
    if (rowIndex >= nRows) break
    if (line.trim() === '') continue

    const parts = line.split('\t')
    rowIdVector.values[rowIndex] = parts[0]
    rowVectors.forEach((v, mi) => { v.values[rowIndex] = parts[1 + mi] ?? '' })

    for (let col = 0; col < nCols; col++) {
      const raw = parts[colNameOffset + col]
      dataset.setValue(rowIndex, col, raw !== undefined && raw !== '' ? parseFloat(raw) : NaN)
    }

    rowIndex++
    onProgress?.({ rowsRead: rowIndex, totalRows: nRows })
  }

  return dataset
}
