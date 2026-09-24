import type { Vector } from '../../core/MetadataModel'
import type { TestName } from '../../stats/types'

export const TEST_OPTIONS: { value: TestName; label: string; hasPValue: boolean }[] = [
  { value: 'ttest',        label: "T-test (Welch's)",              hasPValue: true  },
  { value: 'mann_whitney', label: 'Mann-Whitney U',                hasPValue: true  },
  { value: 'fisher_exact', label: 'Fisher exact (binary data)',    hasPValue: true  },
  { value: 'binomial',     label: 'Binomial test',                 hasPValue: true  },
  { value: 'zscore_test',  label: 'Z-score (combine p-values)',    hasPValue: true  },
  { value: 'snr',          label: 'Signal-to-noise ratio',         hasPValue: false },
  { value: 'snr_adj',      label: 'Signal-to-noise (adjusted SD)', hasPValue: false },
  { value: 'fold_change',  label: 'Fold change (log₂)',            hasPValue: false },
  { value: 'mean_diff',    label: 'Mean difference',               hasPValue: false },
]

const CORRECTION_OPTIONS = [
  { value: 'BH',         label: 'BH FDR (recommended)' },
  { value: 'Bonferroni', label: 'Bonferroni'            },
  { value: 'none',       label: 'None (raw p-values)'   },
] as const

interface Props {
  colAnnotVecs: Vector[]
  selectedField: string
  onFieldChange: (field: string) => void
  groupAssignments: Map<string, 'A' | 'B'>
  onAssign: (value: string, group: 'A' | 'B' | null) => void
  groupACount: number
  groupBCount: number
  test: TestName
  onTestChange: (t: TestName) => void
  correction: 'BH' | 'Bonferroni' | 'none'
  onCorrectionChange: (c: 'BH' | 'Bonferroni' | 'none') => void
  running: boolean
  progress: number
  onRun: () => void
  onClose: () => void
  isDark: boolean
}

export function GroupBuilder({
  colAnnotVecs, selectedField, onFieldChange,
  groupAssignments, onAssign,
  groupACount, groupBCount,
  test, onTestChange,
  correction, onCorrectionChange,
  running, progress,
  onRun, onClose,
  isDark,
}: Props) {
  const vec = colAnnotVecs.find(v => v.name === selectedField)

  const uniqueValues = vec
    ? Array.from(new Set(vec.values.filter(v => v != null).map(String))).sort()
    : []

  const canRun = groupACount > 0 && groupBCount > 0 && !running

  const headerBg  = isDark ? '#10101e' : '#f5f5f5'
  const btnIdleBorder = isDark ? '#374151' : '#d1d5db'
  const btnIdleColor  = isDark ? '#4b5563' : '#9ca3af'

  const runBtn = canRun
    ? { background: isDark ? '#3730a3' : '#2563eb', color: isDark ? '#c7d2fe' : '#ffffff', border: isDark ? '#4338ca' : '#1d4ed8' }
    : { background: isDark ? '#1e1e3a' : '#e5e7eb', color: isDark ? '#4b5563' : '#9ca3af', border: isDark ? '#4338ca' : '#d1d5db' }

  return (
    <div className="flex flex-col text-xs font-mono text-[--color-text]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[--color-border] shrink-0"
        style={{ background: headerBg }}>
        <span className="font-semibold text-sm text-[--color-accent]">Compare Groups</span>
        <button onClick={onClose}
          className="text-[--color-text-muted] hover:text-[--color-text] text-base leading-none px-1">×</button>
      </div>

      <div className="flex flex-col gap-3 p-3">

        {/* Annotation field picker */}
        <div>
          <label className="block text-[--color-text-muted] mb-1">Annotation field</label>
          <select
            value={selectedField}
            onChange={e => onFieldChange(e.target.value)}
            className="w-full bg-[--color-bg] border border-[--color-border] rounded px-2 py-1 text-xs text-[--color-text] outline-none focus:border-[--color-accent]"
          >
            {colAnnotVecs.length === 0 && (
              <option value="">— load an annotation first —</option>
            )}
            {colAnnotVecs.map(v => (
              <option key={v.name} value={v.name}>{v.name}</option>
            ))}
          </select>
        </div>

        {/* Category value assignment */}
        {vec && uniqueValues.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[--color-text-muted]">Assign categories</span>
              <button
                onClick={() => uniqueValues.forEach(v => onAssign(v, null))}
                className="text-[--color-text-muted] hover:text-[--color-text] underline text-[10px]"
              >clear</button>
            </div>
            <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto pr-1">
              {uniqueValues.map(val => {
                const grp = groupAssignments.get(val)
                return (
                  <div key={val} className="flex items-center gap-1">
                    <button
                      onClick={() => onAssign(val, grp === 'A' ? null : 'A')}
                      className="w-6 h-5 rounded text-[10px] font-bold shrink-0 transition-colors"
                      style={{
                        background: grp === 'A' ? '#2563eb' : 'transparent',
                        color:      grp === 'A' ? '#fff'    : btnIdleColor,
                        border: `1px solid ${grp === 'A' ? '#3b82f6' : btnIdleBorder}`,
                      }}>A</button>
                    <button
                      onClick={() => onAssign(val, grp === 'B' ? null : 'B')}
                      className="w-6 h-5 rounded text-[10px] font-bold shrink-0 transition-colors"
                      style={{
                        background: grp === 'B' ? '#dc2626' : 'transparent',
                        color:      grp === 'B' ? '#fff'    : btnIdleColor,
                        border: `1px solid ${grp === 'B' ? '#ef4444' : btnIdleBorder}`,
                      }}>B</button>
                    <span className="truncate flex-1 text-[--color-text-muted]" title={val}>{val}</span>
                  </div>
                )
              })}
            </div>
            <div className="mt-1 text-[--color-text-muted] text-[10px]">
              <span style={{ color: '#3b82f6' }}>A: {groupACount} cols</span>
              <span className="mx-2">·</span>
              <span style={{ color: '#ef4444' }}>B: {groupBCount} cols</span>
            </div>
          </div>
        )}

        {/* Test selection */}
        <div>
          <label className="block text-[--color-text-muted] mb-1">Statistical test</label>
          <select
            value={test}
            onChange={e => onTestChange(e.target.value as TestName)}
            className="w-full bg-[--color-bg] border border-[--color-border] rounded px-2 py-1 text-xs text-[--color-text] outline-none focus:border-[--color-accent]"
          >
            {TEST_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* P-value correction */}
        <div>
          <label className="block text-[--color-text-muted] mb-1">Correction</label>
          <select
            value={correction}
            onChange={e => onCorrectionChange(e.target.value as 'BH' | 'Bonferroni' | 'none')}
            className="w-full bg-[--color-bg] border border-[--color-border] rounded px-2 py-1 text-xs text-[--color-text] outline-none focus:border-[--color-accent]"
          >
            {CORRECTION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Run button + progress */}
        <div>
          <button
            onClick={onRun}
            disabled={!canRun}
            className="w-full py-1.5 rounded text-xs font-semibold transition-colors"
            style={{
              background:  runBtn.background,
              color:       runBtn.color,
              border:      `1px solid ${runBtn.border}`,
              cursor:      canRun ? 'pointer' : 'not-allowed',
            }}
          >
            {running ? 'Running…' : 'Run comparison'}
          </button>
          {running && (
            <div className="mt-1.5 w-full h-1 rounded bg-[--color-bg] overflow-hidden">
              <div className="h-full rounded transition-all"
                style={{ width: `${Math.round(progress * 100)}%`, background: '#6366f1' }} />
            </div>
          )}
          {groupACount === 0 || groupBCount === 0 ? (
            <div className="mt-1 text-[--color-text-muted] text-[10px]">
              Assign at least one category to each group to run.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
