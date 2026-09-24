export type FileFormat = 'gct' | 'tsv' | 'csv' | 'parquet' | 'arrow' | 'cls' | 'tdm' | 'unknown'

/**
 * Detect file format from extension and, for ambiguous cases, the first bytes.
 */
export async function detectFormat(file: File): Promise<FileFormat> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.tdm')) return 'tdm'
  if (name.endsWith('.gct')) return 'gct'
  if (name.endsWith('.cls')) return 'cls'
  if (name.endsWith('.parquet')) return 'parquet'
  if (name.endsWith('.arrow') || name.endsWith('.ipc') || name.endsWith('.feather')) return 'arrow'
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.tsv') || name.endsWith('.txt')) return 'tsv'

  // Sniff first 4 bytes for magic numbers
  const magic = await readMagicBytes(file, 4)
  if (magic === 'PAR1') return 'parquet'
  if (magic === 'ARRO') return 'arrow'  // ARROW1 magic prefix
  if (magic.startsWith('#1.')) return 'gct'

  // Fall back to tab-delimited if it's plain text
  if (isText(magic)) return 'tsv'

  return 'unknown'
}

async function readMagicBytes(file: File, n: number): Promise<string> {
  const slice = file.slice(0, n)
  const buf = await slice.arrayBuffer()
  return new TextDecoder().decode(buf)
}

function isText(sample: string): boolean {
  return /^[\x09\x0a\x0d\x20-\x7e]*$/.test(sample)
}
