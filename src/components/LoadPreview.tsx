import type { Dataset } from '../core/Dataset'

interface LoadPreviewProps {
  dataset: Dataset
  filename: string
  onOpen: () => void
  onBack: () => void
}

const PREVIEW_ROWS = 5
const PREVIEW_COLS = 6

export function LoadPreview({ dataset, filename, onOpen, onBack }: LoadPreviewProps) {
  const { rowCount, colCount, seriesNames, rowMetadata, colMetadata } = dataset

  const rowIdVec = rowMetadata.getVector('id')
  const colIdVec = colMetadata.getVector('id')

  const previewRows = Math.min(PREVIEW_ROWS, rowCount)
  const previewCols = Math.min(PREVIEW_COLS, colCount)

  const colHeaders = Array.from({ length: previewCols }, (_, c) =>
    (colIdVec?.values[c] as string | null) ?? `Col ${c + 1}`
  )

  return (
    <div className="flex flex-col h-full p-6 gap-6 overflow-auto">
      {/* File summary */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="text-green-400 text-lg">✓</span>
          <span className="font-mono text-sm text-[--color-text-muted]">{filename}</span>
        </div>
        <div className="flex gap-6 mt-2 flex-wrap">
          <Stat label="Genes (rows)" value={rowCount.toLocaleString()} />
          <Stat label="Samples (cols)" value={colCount.toLocaleString()} />
          <Stat label="Data series" value={String(seriesNames.length)} />
          <Stat label="Row annotations" value={String(Math.max(0, rowMetadata.vectors.length - 1))} />
          <Stat label="Column annotations" value={String(Math.max(0, colMetadata.vectors.length - 1))} />
        </div>
      </div>

      {/* Series chips */}
      {seriesNames.length > 0 && (
        <div>
          <p className="text-xs text-[--color-text-muted] uppercase tracking-wider mb-2">Data series</p>
          <div className="flex gap-2 flex-wrap">
            {seriesNames.map(name => (
              <span
                key={name}
                className="px-2 py-1 rounded font-mono text-xs bg-[--color-surface] border border-[--color-border] text-[--color-accent]"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Preview table */}
      <div>
        <p className="text-xs text-[--color-text-muted] uppercase tracking-wider mb-2">
          Preview — first {previewRows} rows, {previewCols} columns
          {(rowCount > PREVIEW_ROWS || colCount > PREVIEW_COLS) && (
            <span className="ml-2 normal-case">
              ({rowCount.toLocaleString()} × {colCount.toLocaleString()} total)
            </span>
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="text-xs font-mono border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-1.5 text-left text-[--color-text-muted] border-b border-[--color-border] bg-[--color-surface]">
                  Gene
                </th>
                {colHeaders.map((h, i) => (
                  <th
                    key={i}
                    className="px-3 py-1.5 text-right text-[--color-text-muted] border-b border-[--color-border] bg-[--color-surface] max-w-[100px] truncate"
                  >
                    {h}
                  </th>
                ))}
                {colCount > PREVIEW_COLS && (
                  <th className="px-3 py-1.5 text-[--color-text-muted] border-b border-[--color-border] bg-[--color-surface]">
                    …
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: previewRows }, (_, r) => (
                <tr key={r} className="hover:bg-[--color-surface] transition-colors">
                  <td className="px-3 py-1.5 text-[--color-text] border-b border-[--color-border]">
                    {(rowIdVec?.values[r] as string | null) ?? `Row ${r + 1}`}
                  </td>
                  {Array.from({ length: previewCols }, (_, c) => {
                    const val = dataset.getValue(r, c)
                    return (
                      <td
                        key={c}
                        className="px-3 py-1.5 text-right border-b border-[--color-border]"
                        style={{ color: cellColor(val) }}
                      >
                        {isNaN(val) ? <span className="text-[--color-text-muted]">—</span> : formatNum(val)}
                      </td>
                    )
                  })}
                  {colCount > PREVIEW_COLS && (
                    <td className="px-3 py-1.5 text-[--color-text-muted] border-b border-[--color-border]">…</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-auto pt-2">
        <button
          onClick={onOpen}
          className="px-6 py-2 rounded-lg bg-[--color-accent] hover:bg-[#3b7af0] text-white text-sm font-semibold transition-colors"
        >
          Open Matrix
        </button>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text] text-sm transition-colors"
        >
          Load different file
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-[--color-text-muted]">{label}</span>
      <span className="font-mono text-base font-semibold text-[--color-text]">{value}</span>
    </div>
  )
}

function formatNum(v: number): string {
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) {
    return v.toExponential(2)
  }
  return v.toFixed(3)
}

// Simple value-to-color for the preview table — blue (low) → white → red (high)
function cellColor(v: number): string {
  if (isNaN(v)) return '#666'
  if (v > 0) return `rgba(239,68,68,${Math.min(1, Math.abs(v) / 3)})`
  return `rgba(79,142,247,${Math.min(1, Math.abs(v) / 3)})`
}
