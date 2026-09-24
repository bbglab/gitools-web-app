import type { Dataset } from '../core/Dataset'

export interface AnnotationField {
  name: string
  values: (string | number | null)[]
  dataType: 'string' | 'number'
}

function stripQuotes(s: string): string {
  s = s.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

async function* readLines(file: File): AsyncGenerator<string> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) { if (buffer) yield buffer; break }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!
    for (const line of lines) yield line
  }
}

/**
 * Parse a Gitools-style annotation TSV and merge into an existing dataset.
 *
 * Format:
 *   Row 1:  identifier\t"Field1"\t"Field2"\t...  (column headers; first col is the ID)
 *   Row 2+: lines starting with '#' are metadata/comment rows — skipped
 *   Data:   id_value\t"val1"\t"val2"\t...        (quoted or unquoted values)
 *
 * axis: 'row' matches against dataset.rowMetadata 'id' vector
 *       'col' matches against dataset.colMetadata 'id' vector
 *
 * Returns the number of fields added.
 */
export async function loadAnnotationTsv(
  file: File,
  dataset: Dataset,
  axis: 'row' | 'col',
): Promise<number> {
  const meta   = axis === 'row' ? dataset.rowMetadata : dataset.colMetadata
  const idVec  = meta.getVector('id')
  if (!idVec) throw new Error(`Dataset has no '${axis}' id vector — load the matrix first.`)

  // Build a lookup: id → metadata index
  const idIndex = new Map<string, number>()
  idVec.values.forEach((v, i) => { if (v != null) idIndex.set(String(v), i) })

  const size = axis === 'row' ? dataset.rowCount : dataset.colCount

  let fieldNames: string[] = []
  const fieldArrays: (string | number | null)[][] = []
  let headerParsed = false

  for await (const line of readLines(file)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (trimmed.startsWith('#')) continue          // skip comment/metadata rows

    const parts = trimmed.split('\t')

    if (!headerParsed) {
      // First non-comment row = header
      // parts[0] = 'identifier' (or similar), rest = field names
      fieldNames = parts.slice(1).map(stripQuotes)
      for (let f = 0; f < fieldNames.length; f++) {
        fieldArrays.push(new Array(size).fill(null))
      }
      headerParsed = true
      continue
    }

    const id  = stripQuotes(parts[0])
    const idx = idIndex.get(id)
    if (idx === undefined) continue               // id not in matrix — skip

    for (let f = 0; f < fieldNames.length; f++) {
      const raw = stripQuotes(parts[f + 1] ?? '')
      if (raw === '' || raw === 'NA' || raw === 'null') {
        fieldArrays[f][idx] = null
      } else {
        const n = Number(raw)
        fieldArrays[f][idx] = isNaN(n) ? raw : n
      }
    }
  }

  // Merge into dataset metadata (skip fields that already exist)
  let added = 0
  for (let f = 0; f < fieldNames.length; f++) {
    const name = fieldNames[f]
    if (!name || meta.getVector(name)) continue   // already exists
    // Determine dataType from values
    const hasNumber = fieldArrays[f].some(v => typeof v === 'number')
    const hasString = fieldArrays[f].some(v => typeof v === 'string')
    const dataType  = hasNumber && !hasString ? 'number' : 'string'
    const vec = meta.addVector(name, dataType)
    for (let i = 0; i < size; i++) vec.values[i] = fieldArrays[f][i]
    added++
  }
  return added
}
