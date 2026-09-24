import { useState } from 'react'

// ── Public types ──────────────────────────────────────────────────────────────

export interface ValueFilterRule {
  id: string
  aggregate: 'mean' | 'min' | 'max' | 'pct_empty'
  operator: '>' | '<' | '>=' | '<=' | '==' | '!='
  threshold: number
  series: number
}

export interface IdFilterConfig {
  ids: Set<string>
  mode: 'include' | 'exclude'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AGG_LABELS: Record<ValueFilterRule['aggregate'], string> = {
  mean:      'mean',
  min:       'min',
  max:       'max',
  pct_empty: '% empty',
}

export const OP_LABELS: Record<ValueFilterRule['operator'], string> = {
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  '==': '=',
  '!=': '≠',
}

function parseIds(text: string): Set<string> {
  return new Set(text.split(/[\n,\t]+/).map(s => s.trim()).filter(Boolean))
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  seriesNames: string[]
  rowValueFilters: ValueFilterRule[]
  colValueFilters: ValueFilterRule[]
  rowIdFilter: IdFilterConfig | null
  colIdFilter: IdFilterConfig | null
  onRowValueFiltersChange: (rules: ValueFilterRule[]) => void
  onColValueFiltersChange: (rules: ValueFilterRule[]) => void
  onRowIdFilterChange: (filter: IdFilterConfig | null) => void
  onColIdFilterChange: (filter: IdFilterConfig | null) => void
  onClose: () => void
  isDark: boolean
}

export function FilterPanel({
  seriesNames,
  rowValueFilters, colValueFilters,
  rowIdFilter, colIdFilter,
  onRowValueFiltersChange, onColValueFiltersChange,
  onRowIdFilterChange, onColIdFilterChange,
  onClose, isDark,
}: Props) {
  const [axis, setAxis] = useState<'rows' | 'cols'>('rows')

  // Local ID textarea text — one per axis so switching doesn't lose unsaved text
  const [rowIdText, setRowIdText] = useState(
    () => rowIdFilter ? [...rowIdFilter.ids].join('\n') : '',
  )
  const [colIdText, setColIdText] = useState(
    () => colIdFilter ? [...colIdFilter.ids].join('\n') : '',
  )
  const [rowIdMode, setRowIdMode] = useState<'include' | 'exclude'>(
    rowIdFilter?.mode ?? 'include',
  )
  const [colIdMode, setColIdMode] = useState<'include' | 'exclude'>(
    colIdFilter?.mode ?? 'include',
  )

  const isRows      = axis === 'rows'
  const valueFilters = isRows ? rowValueFilters : colValueFilters
  const idText       = isRows ? rowIdText       : colIdText
  const idMode       = isRows ? rowIdMode        : colIdMode

  // ── Theme ──
  const bg      = isDark ? '#0a0a12' : '#ffffff'
  const surface = isDark ? '#10101e' : '#f5f5f5'
  const border  = isDark ? '#2a2a45' : '#e0e0e0'
  const text    = isDark ? '#e2e8f0' : '#1a1a1a'
  const muted   = isDark ? '#6b7280' : '#6b7280'
  const accent  = isDark ? '#a0a8ff' : '#2563eb'
  const tabActive = isDark
    ? { background: '#2a2a6e', color: '#a0a8ff', borderColor: '#4040a0' }
    : { background: '#dbeafe', color: '#1d4ed8', borderColor: '#93c5fd' }
  const tabIdle = isDark
    ? { background: 'transparent', color: '#6b7280', borderColor: '#2a2a45' }
    : { background: 'transparent', color: '#6b7280', borderColor: '#e0e0e0' }
  const inputStyle: React.CSSProperties = {
    background: isDark ? '#0f0f22' : '#fff',
    color: text,
    border: `1px solid ${border}`,
    outline: 'none',
  }

  // ── Value filter operations ──
  const setValueFilters = isRows ? onRowValueFiltersChange : onColValueFiltersChange

  const addRule = () =>
    setValueFilters([...valueFilters, {
      id: Math.random().toString(36).slice(2),
      aggregate: 'mean',
      operator: '>',
      threshold: 0,
      series: 0,
    }])

  const removeRule = (id: string) =>
    setValueFilters(valueFilters.filter(r => r.id !== id))

  const updateRule = (id: string, patch: Partial<ValueFilterRule>) =>
    setValueFilters(valueFilters.map(r => r.id === id ? { ...r, ...patch } : r))

  // ── ID filter operations ──
  const applyIdText = (raw: string, mode: 'include' | 'exclude') => {
    const ids = parseIds(raw)
    const cfg = ids.size > 0 ? { ids, mode } : null
    if (isRows) onRowIdFilterChange(cfg)
    else        onColIdFilterChange(cfg)
  }

  const handleIdTextChange = (raw: string) => {
    if (isRows) setRowIdText(raw); else setColIdText(raw)
    applyIdText(raw, idMode)
  }

  const handleIdModeChange = (mode: 'include' | 'exclude') => {
    if (isRows) setRowIdMode(mode); else setColIdMode(mode)
    applyIdText(idText, mode)
  }

  const clearAxis = () => {
    setValueFilters([])
    if (isRows) { onRowIdFilterChange(null); setRowIdText('') }
    else        { onColIdFilterChange(null); setColIdText('') }
  }

  // ── Badge counts for tabs ──
  const rowBadge = rowValueFilters.length + (rowIdFilter ? 1 : 0)
  const colBadge = colValueFilters.length + (colIdFilter ? 1 : 0)

  // ── Render ──
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="flex flex-col rounded-lg shadow-2xl"
        style={{ background: bg, border: `1px solid ${border}`, width: 540, maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b"
          style={{ background: surface, borderColor: border }}>
          <span className="font-semibold text-sm" style={{ color: accent }}>Filter rows / columns</span>
          <button onClick={onClose} className="text-lg leading-none px-1 hover:opacity-70" style={{ color: muted }}>×</button>
        </div>

        {/* Axis tabs */}
        <div className="flex gap-2 px-5 pt-3 pb-0 shrink-0">
          {(['rows', 'cols'] as const).map(a => {
            const badge = a === 'rows' ? rowBadge : colBadge
            return (
              <button key={a} onClick={() => setAxis(a)}
                className="px-3 py-1 rounded text-xs font-mono border transition-colors"
                style={axis === a ? tabActive : tabIdle}>
                {a === 'rows' ? 'Rows' : 'Columns'}
                {badge > 0 && (
                  <span className="ml-1.5 px-1 rounded text-[9px] font-semibold"
                    style={{ background: isDark ? '#4040a0' : '#bfdbfe', color: isDark ? '#a0a8ff' : '#1d4ed8' }}>
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-5 text-xs font-mono" style={{ color: text }}>

          {/* ── Value filters ── */}
          <div>
            <div className="font-semibold mb-1" style={{ color: accent }}>Filter by value</div>
            <p className="mb-3" style={{ color: muted }}>
              Keep {isRows ? 'rows' : 'columns'} where the aggregate of their values satisfies the condition.
              {seriesNames.length > 1 && ' Choose which data series to compute on.'}
            </p>

            {valueFilters.length === 0 && (
              <div className="text-center py-4 rounded border border-dashed"
                style={{ borderColor: border, color: muted }}>
                No value filters active — click + below to add one
              </div>
            )}

            <div className="flex flex-col gap-1">
              {valueFilters.map(rule => (
                <div key={rule.id} className="flex items-center gap-1.5 py-0.5">
                  {/* Aggregate */}
                  <select
                    value={rule.aggregate}
                    onChange={e => updateRule(rule.id, { aggregate: e.target.value as ValueFilterRule['aggregate'] })}
                    className="rounded px-1.5 py-0.5 text-xs font-mono"
                    style={{ ...inputStyle, width: 90 }}
                  >
                    {Object.entries(AGG_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>

                  {/* Operator */}
                  <select
                    value={rule.operator}
                    onChange={e => updateRule(rule.id, { operator: e.target.value as ValueFilterRule['operator'] })}
                    className="rounded px-1.5 py-0.5 text-xs font-mono"
                    style={{ ...inputStyle, width: 50 }}
                  >
                    {Object.entries(OP_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>

                  {/* Threshold */}
                  <input
                    type="number"
                    step="any"
                    value={rule.threshold}
                    onChange={e => {
                      const n = parseFloat(e.target.value)
                      if (!isNaN(n)) updateRule(rule.id, { threshold: n })
                    }}
                    className="rounded px-1.5 py-0.5 text-xs font-mono w-24"
                    style={inputStyle}
                  />

                  {/* Series selector */}
                  {seriesNames.length > 1 && (
                    <>
                      <span style={{ color: muted }}>on</span>
                      <select
                        value={rule.series}
                        onChange={e => updateRule(rule.id, { series: parseInt(e.target.value) })}
                        className="rounded px-1.5 py-0.5 text-xs font-mono"
                        style={{ ...inputStyle, maxWidth: 110 }}
                      >
                        {seriesNames.map((s, i) => <option key={i} value={i}>{s}</option>)}
                      </select>
                    </>
                  )}

                  <button onClick={() => removeRule(rule.id)}
                    className="ml-auto hover:opacity-70" style={{ color: muted }}
                    title="Remove rule">×</button>
                </div>
              ))}
            </div>

            <button
              onClick={addRule}
              className="mt-2 px-2 py-1 rounded text-xs border hover:opacity-80 transition-opacity"
              style={{ color: accent, borderColor: isDark ? '#4040a0' : '#93c5fd' }}
            >
              + Add rule
            </button>
          </div>

          {/* ── ID list filter ── */}
          <div>
            <div className="font-semibold mb-1" style={{ color: accent }}>Filter by ID list</div>

            <div className="flex items-center gap-2 mb-2">
              <select
                value={idMode}
                onChange={e => handleIdModeChange(e.target.value as 'include' | 'exclude')}
                className="rounded px-1.5 py-0.5 text-xs font-mono"
                style={{ ...inputStyle, width: 82 }}
              >
                <option value="include">Include</option>
                <option value="exclude">Exclude</option>
              </select>
              <span style={{ color: muted }}>
                only {isRows ? 'rows' : 'columns'} whose ID is in this list
              </span>
            </div>

            <textarea
              value={idText}
              onChange={e => handleIdTextChange(e.target.value)}
              placeholder={'Paste IDs here — one per line, or comma-separated'}
              rows={7}
              className="w-full rounded px-2 py-1.5 text-xs font-mono resize-y"
              style={{ ...inputStyle, display: 'block' }}
            />

            <div className="flex items-center justify-between mt-1" style={{ color: muted }}>
              <span>
                {parseIds(idText).size > 0
                  ? `${parseIds(idText).size} ID${parseIds(idText).size > 1 ? 's' : ''} entered`
                  : 'no IDs entered — paste to activate'}
              </span>
              {idText && (
                <button onClick={() => handleIdTextChange('')} className="underline hover:opacity-70">
                  clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 shrink-0 border-t"
          style={{ background: surface, borderColor: border }}>
          <span className="text-[10px]" style={{ color: muted }}>
            Filters apply to the heatmap immediately.
          </span>
          <button
            onClick={clearAxis}
            className="px-2.5 py-1 rounded text-xs border hover:opacity-80 transition-opacity"
            style={{ color: muted, borderColor: border }}
          >
            Clear {isRows ? 'row' : 'column'} filters
          </button>
        </div>
      </div>
    </div>
  )
}
