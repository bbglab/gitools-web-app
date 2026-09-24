import type { Dataset } from '../core/Dataset'

/**
 * Serialize the currently visible slice of the dataset to GCT v1.2 (single series).
 * rowOrder / colOrder are the display orders after filtering and sorting.
 */
export function writeGctV12(
  dataset: Dataset,
  rowOrder: number[],
  colOrder: number[],
  seriesIndex = 0,
): string {
  const rowIdVec = dataset.rowMetadata.getVector('id')
  const colIdVec = dataset.colMetadata.getVector('id')
  const descVec  = dataset.rowMetadata.vectors.find(v => v.name !== 'id')

  const lines: string[] = [
    '#1.2',
    `${rowOrder.length}\t${colOrder.length}`,
    [
      'Name',
      'Description',
      ...colOrder.map(dc =>
        colIdVec?.values[dc] != null ? String(colIdVec.values[dc]) : `S${dc}`
      ),
    ].join('\t'),
  ]

  for (const dr of rowOrder) {
    const name = rowIdVec?.values[dr] != null ? String(rowIdVec.values[dr]) : `R${dr}`
    const desc = descVec?.values[dr] != null ? String(descVec.values[dr]) : 'na'
    const vals = colOrder.map(dc => {
      const v = dataset.getValue(dr, dc, seriesIndex)
      return isNaN(v) ? '' : String(v)
    })
    lines.push([name, desc, ...vals].join('\t'))
  }

  return lines.join('\n')
}

export function downloadText(content: string, filename: string, mimeType = 'text/tab-separated-values'): void {
  const blob = new Blob([content], { type: mimeType })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
