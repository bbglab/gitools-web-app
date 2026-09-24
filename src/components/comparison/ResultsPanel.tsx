import { useState, useMemo, useRef } from 'react'
import type { RowResult } from '../../stats/types'
import { VolcanoPlot } from './VolcanoPlot'

type SortKey = 'score' | 'pvalue' | 'fdr' | 'meanA' | 'meanB'
type SortDir = 'asc' | 'desc'

interface Props {
  results: RowResult[]
  hasPValue: boolean
  onGeneClick: (rowIndex: number) => void
  onAddAnnotations: (results: RowResult[]) => void
  isDark: boolean
}

const ROW_H   = 22
const TABLE_H = 280

function fmt(v: number): string {
  if (isNaN(v) || !isFinite(v)) return '—'
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(2)
  return v.toFixed(3)
}

export function ResultsPanel({ results, hasPValue, onGeneClick, onAddAnnotations, isDark }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [scrollTop, setScrollTop] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => {
    const s = sortDir === 'desc' ? -1 : 1
    return [...results].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      if (isNaN(va) && isNaN(vb)) return 0
      if (isNaN(va)) return 1
      if (isNaN(vb)) return -1
      return s * (va - vb)
    })
  }, [results, sortKey, sortDir])

  const visStart = Math.max(0, Math.floor(scrollTop / ROW_H) - 2)
  const visEnd   = Math.min(sorted.length, visStart + Math.ceil(TABLE_H / ROW_H) + 4)

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function arrow(key: SortKey) {
    if (key !== sortKey) return ' ↕'
    return sortDir === 'desc' ? ' ↓' : ' ↑'
  }

  function exportTSV() {
    const cols = ['gene', 'score', 'pvalue', 'fdr', 'meanA', 'meanB']
    const rows = sorted.map(r =>
      [r.name, r.score, r.pvalue, r.fdr, r.meanA, r.meanB]
        .map(v => (typeof v === 'number' ? (isNaN(v) ? '' : v) : v))
        .join('\t')
    )
    const tsv  = [cols.join('\t'), ...rows].join('\n')
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = 'comparison_results.tsv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const panelBg  = isDark ? '#0d0d1a' : '#ffffff'
  const headerBg = isDark ? '#10101e' : '#f5f5f5'
  const headerBorder = isDark ? '#2a2a45' : '#e5e7eb'
  const rowEven  = isDark ? '#0a0a12' : '#ffffff'
  const rowOdd   = isDark ? '#0d0d1a' : '#f9fafb'
  const rowHover = isDark ? '#1a1a3a' : '#eff6ff'
  const mutedTxt = isDark ? '#9ca3af' : '#6b7280'
  const sigGene  = isDark ? '#a5b4fc' : '#1d4ed8'
  const normGene = isDark ? '#9ca3af' : '#374151'
  const posScore = isDark ? '#60a5fa' : '#1d4ed8'
  const negScore = isDark ? '#f87171' : '#dc2626'
  const sigFdr   = isDark ? '#a5b4fc' : '#1d4ed8'
  const dimFdr   = isDark ? '#6b7280' : '#9ca3af'

  const thStyle: React.CSSProperties = {
    position: 'sticky', top: 0, zIndex: 1,
    background: headerBg,
    padding: '2px 4px',
    borderBottom: `1px solid ${headerBorder}`,
    textAlign: 'right', whiteSpace: 'nowrap',
    cursor: 'pointer', userSelect: 'none',
    color: mutedTxt,
  }

  return (
    <div className="flex flex-col" style={{ background: panelBg }}>
      {/* Volcano / score plot */}
      <div className="flex justify-center border-b border-[--color-border] pt-2">
        <VolcanoPlot results={sorted} hasPValue={hasPValue} onGeneClick={onGeneClick} isDark={isDark} />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 px-3 py-1.5 border-b border-[--color-border] shrink-0">
        <button onClick={exportTSV}
          className="text-[10px] px-2 py-0.5 rounded border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text]">
          Export TSV
        </button>
        <button onClick={() => onAddAnnotations(results)}
          className="text-[10px] px-2 py-0.5 rounded border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text]">
          Add to annotations
        </button>
        <span className="ml-auto text-[10px] self-center" style={{ color: mutedTxt }}>
          {results.length} genes
          {hasPValue && ` · ${results.filter(r => r.fdr <= 0.05).length} FDR ≤ 0.05`}
        </span>
      </div>

      {/* Virtual table */}
      <div
        ref={scrollRef}
        style={{ height: TABLE_H, overflowY: 'auto' }}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table className="w-full border-collapse" style={{ fontSize: 10, fontFamily: 'monospace' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', width: 110 }} onClick={() => toggleSort('score')}>Gene</th>
              <th style={thStyle} onClick={() => toggleSort('score')}>Score{arrow('score')}</th>
              {hasPValue && <>
                <th style={thStyle} onClick={() => toggleSort('pvalue')}>p-value{arrow('pvalue')}</th>
                <th style={thStyle} onClick={() => toggleSort('fdr')}>FDR{arrow('fdr')}</th>
              </>}
              <th style={thStyle} onClick={() => toggleSort('meanA')}>Mean A{arrow('meanA')}</th>
              <th style={thStyle} onClick={() => toggleSort('meanB')}>Mean B{arrow('meanB')}</th>
            </tr>
          </thead>
          <tbody>
            {visStart > 0 && (
              <tr><td colSpan={hasPValue ? 6 : 4} style={{ height: visStart * ROW_H, padding: 0 }} /></tr>
            )}
            {sorted.slice(visStart, visEnd).map((r, i) => {
              const sig = hasPValue && r.fdr <= 0.05
              return (
                <tr
                  key={r.rowIndex}
                  onClick={() => onGeneClick(r.rowIndex)}
                  style={{
                    height: ROW_H,
                    cursor: 'pointer',
                    background: (visStart + i) % 2 === 0 ? rowEven : rowOdd,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = (visStart + i) % 2 === 0 ? rowEven : rowOdd)}
                >
                  <td style={{ padding: '1px 4px', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: sig ? sigGene : normGene }} title={r.name}>{r.name}</span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '1px 4px', color: r.score > 0 ? posScore : r.score < 0 ? negScore : mutedTxt }}>
                    {fmt(r.score)}
                  </td>
                  {hasPValue && <>
                    <td style={{ textAlign: 'right', padding: '1px 4px', color: mutedTxt }}>{fmt(r.pvalue)}</td>
                    <td style={{ textAlign: 'right', padding: '1px 4px', color: sig ? sigFdr : dimFdr }}>{fmt(r.fdr)}</td>
                  </>}
                  <td style={{ textAlign: 'right', padding: '1px 4px', color: mutedTxt }}>{fmt(r.meanA)}</td>
                  <td style={{ textAlign: 'right', padding: '1px 4px', color: mutedTxt }}>{fmt(r.meanB)}</td>
                </tr>
              )
            })}
            {visEnd < sorted.length && (
              <tr><td colSpan={hasPValue ? 6 : 4} style={{ height: (sorted.length - visEnd) * ROW_H, padding: 0 }} /></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
