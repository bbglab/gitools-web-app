import { useRef, useEffect, useState, useCallback, useMemo, DragEvent } from 'react'
import type { Dataset } from '../../core/Dataset'
import type { Vector, VectorValue } from '../../core/MetadataModel'
import {
  createProgram, uploadDataTexture, uploadColormapTexture,
  computeColorRange, COLORMAP_LABELS, COLORMAP_CSS,
} from './webgl'
import type { DataTextureResult, ColormapPreset } from './webgl'
import { ColAnnotationTrack, RowAnnotationTrack, buildCategoryColors } from './AnnotationTrack'
import { FilterPanel, OP_LABELS } from './FilterPanel'
import type { ValueFilterRule, IdFilterConfig } from './FilterPanel'
import { loadAnnotationTsv } from '../../io/AnnotationReader'
import { writeGctV12, downloadText } from '../../io/GctWriter'
import {
  buildSession, downloadSession, parseSessionFile,
  encodeHashState, parseHashState,
  serializeIdFilter,
} from '../../io/sessionIO'
import type { GitoolsSession } from '../../io/sessionIO'
import { GroupBuilder, TEST_OPTIONS } from '../comparison/GroupBuilder'
import { ResultsPanel } from '../comparison/ResultsPanel'
import type { TestName, RowResult, WorkerRequest, WorkerResponse } from '../../stats/types'

const ROW_LABEL_W  = 140
const COL_LABEL_H  = 90
const TRACK_W      = 12
const TRACK_H      = 12
const TEXT_TRACK_W = 80
const TEXT_TRACK_H = 60
const MIN_CELL     = 1
const MAX_CELL     = 120
const DEFAULT_CELL = 14
const PANEL_W      = 360

interface ViewState {
  rowOffset: number
  colOffset: number
  cellW: number
  cellH: number
}

interface Tooltip {
  clientX: number
  clientY: number
  gene: string
  sample: string
  values: number[]
}

interface Theme {
  bg: string
  surface: string
  surface2: string
  textMuted: string
  filterColor: string
  clearColor: [number, number, number, number]
  labelColor: string
  labelHighlight: string
  highlightBg: string
  highlightGlow: string
  seriesActive: { background: string; color: string; borderColor: string }
  seriesIdle:   { background: string; color: string; borderColor: string }
  cmpActive:    { background: string; color: string; borderColor: string }
  cmpIdle:      { background: string; color: string; borderColor: string }
  tooltipBg: string
  tooltipBorder: string
  tooltipValue: string
  tooltipMuted: string
  checkActive: string
  checkBorder: string
  valueActive: string
  valueInactive: string
}

const DARK_THEME: Theme = {
  bg:            '#0a0a12',
  surface:       '#10101e',
  surface2:      '#0f0f22',
  textMuted:     '#6b7280',
  filterColor:   '#fb923c',
  clearColor:    [0.06, 0.06, 0.10, 1],
  labelColor:    '#6b7280',
  labelHighlight:'#fbbf24',
  highlightBg:   'rgba(251,191,36,0.12)',
  highlightGlow: '0 0 10px 2px rgba(251,191,36,0.35)',
  seriesActive:  { background: '#2a2a6e', color: '#a0a8ff', borderColor: '#4040a0' },
  seriesIdle:    { background: 'transparent', color: '#6b7280', borderColor: '#2a2a45' },
  cmpActive:     { background: '#1e1e4a', color: '#a0a8ff', borderColor: '#4040a0' },
  cmpIdle:       { background: 'transparent', color: '#6b7280', borderColor: '#2a2a45' },
  tooltipBg:     'rgba(10,10,20,0.96)',
  tooltipBorder: '#2a2a45',
  tooltipValue:  '#e2e8f0',
  tooltipMuted:  '#6b7280',
  checkActive:   '#4f8ef7',
  checkBorder:   '#4040a0',
  valueActive:   '#9ca3af',
  valueInactive: '#4b5563',
}

const LIGHT_THEME: Theme = {
  bg:            '#ffffff',
  surface:       '#f5f5f5',
  surface2:      '#efefef',
  textMuted:     '#6b7280',
  filterColor:   '#d97706',
  clearColor:    [1, 1, 1, 1],
  labelColor:    '#9ca3af',
  labelHighlight:'#b45309',
  highlightBg:   'rgba(180,83,9,0.08)',
  highlightGlow: '0 0 10px 2px rgba(180,83,9,0.20)',
  seriesActive:  { background: '#dbeafe', color: '#1d4ed8', borderColor: '#93c5fd' },
  seriesIdle:    { background: 'transparent', color: '#6b7280', borderColor: '#e0e0e0' },
  cmpActive:     { background: '#eff6ff', color: '#1d4ed8', borderColor: '#93c5fd' },
  cmpIdle:       { background: 'transparent', color: '#6b7280', borderColor: '#e0e0e0' },
  tooltipBg:     'rgba(255,255,255,0.97)',
  tooltipBorder: '#e0e0e0',
  tooltipValue:  '#1a1a1a',
  tooltipMuted:  '#6b6b6b',
  checkActive:   '#2563eb',
  checkBorder:   '#93c5fd',
  valueActive:   '#374151',
  valueInactive: '#9ca3af',
}

const GROUP_COLORS = new Map([['A', '#3b82f6'], ['B', '#ef4444']])

function identity(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function sortOrder(vec: Vector, order: number[], direction: 'asc' | 'desc'): number[] {
  return [...order].sort((a, b) => {
    const va = vec.values[a], vb = vec.values[b]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return direction === 'asc' ? cmp : -cmp
  })
}

// Unique non-null string values for a vector
function uniqueValues(vec: Vector): string[] {
  return [...new Set(vec.values.filter(v => v != null).map(String))].sort()
}

// ── Value-filter helpers ──────────────────────────────────────────────────────

// cols: the column indices to aggregate over (pass displayColOrder so row filters
// see only the columns that survived the column filter)
function rowAggOver(dataset: Dataset, dr: number, series: number, agg: ValueFilterRule['aggregate'], cols: number[]): number {
  const n = cols.length
  if (n === 0) return agg === 'pct_empty' ? 100 : NaN
  let sum = 0, cnt = 0, mn = Infinity, mx = -Infinity, ne = 0
  for (const dc of cols) {
    const v = dataset.getValue(dr, dc, series)
    if (isNaN(v)) { ne++; continue }
    sum += v; cnt++
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  if (agg === 'mean')      return cnt > 0 ? sum / cnt : NaN
  if (agg === 'min')       return mn < Infinity ? mn : NaN
  if (agg === 'max')       return mx > -Infinity ? mx : NaN
  return (ne / n) * 100  // pct_empty
}

function colAgg(dataset: Dataset, dc: number, series: number, agg: ValueFilterRule['aggregate']): number {
  const n = dataset.rowCount
  let sum = 0, cnt = 0, mn = Infinity, mx = -Infinity, ne = 0
  for (let dr = 0; dr < n; dr++) {
    const v = dataset.getValue(dr, dc, series)
    if (isNaN(v)) { ne++; continue }
    sum += v; cnt++
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  if (agg === 'mean')      return cnt > 0 ? sum / cnt : NaN
  if (agg === 'min')       return mn < Infinity ? mn : NaN
  if (agg === 'max')       return mx > -Infinity ? mx : NaN
  return n > 0 ? (ne / n) * 100 : 0  // pct_empty
}

function passesOp(v: number, op: ValueFilterRule['operator'], t: number): boolean {
  if (isNaN(v)) return false
  if (op === '>')  return v > t
  if (op === '<')  return v < t
  if (op === '>=') return v >= t
  if (op === '<=') return v <= t
  if (op === '==') return v === t
  return v !== t
}

export function HeatmapViewer({ dataset, onDarkModeChange }: { dataset: Dataset; onDarkModeChange?: (dark: boolean) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)

  const glRef      = useRef<WebGL2RenderingContext | null>(null)
  const progRef    = useRef<WebGLProgram | null>(null)
  const dataTexRef = useRef<DataTextureResult | null>(null)
  const cmapTexRef = useRef<WebGLTexture | null>(null)
  const rafRef     = useRef(0)

  const [darkMode, setDarkMode] = useState(false)
  const theme = darkMode ? DARK_THEME : LIGHT_THEME

  useEffect(() => { onDarkModeChange?.(darkMode) }, [darkMode, onDarkModeChange])

  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [viewState, setViewState]   = useState<ViewState>({
    rowOffset: 0, colOffset: 0, cellW: 60, cellH: DEFAULT_CELL,
  })
  const [activeSeries, setActiveSeries] = useState(0)

  // Base sort orders — always contain ALL indices; filtering never mutates these
  const [rowOrder, setRowOrder] = useState<number[]>(() => identity(dataset.rowCount))
  const [colOrder, setColOrder] = useState<number[]>(() => identity(dataset.colCount))

  // Annotation filters — fieldName → Set of allowed values (absent = all shown)
  const [rowFilters, setRowFilters] = useState<Map<string, Set<string>>>(new Map())
  const [colFilters, setColFilters] = useState<Map<string, Set<string>>>(new Map())
  // Value + ID filters
  const [rowValueFilters, setRowValueFilters] = useState<ValueFilterRule[]>([])
  const [colValueFilters, setColValueFilters] = useState<ValueFilterRule[]>([])
  const [rowIdFilter,     setRowIdFilter]     = useState<IdFilterConfig | null>(null)
  const [colIdFilter,     setColIdFilter]     = useState<IdFilterConfig | null>(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  const [texVersion, setTexVersion] = useState(0)
  const [tooltip, setTooltip]       = useState<Tooltip | null>(null)
  const [isDragging, setDrag]       = useState(false)
  const [glError, setGlError]       = useState<string | null>(null)
  const [search, setSearch]         = useState('')
  const [highlightedRows, setHighlightedRows] = useState<Set<number>>(new Set())
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const [visColTracks, setVisColTracks] = useState<Set<string>>(new Set())
  const [visRowTracks, setVisRowTracks] = useState<Set<string>>(new Set())
  const [annotVersion, setAnnotVersion] = useState(0)
  const [annotLoading, setAnnotLoading] = useState(false)
  const [annotError,   setAnnotError]   = useState<string | null>(null)
  const [trackDisplayModes, setTrackDisplayModes] = useState<Map<string, 'color' | 'text'>>(new Map())
  const [customColors,      setCustomColors]      = useState<Map<string, Map<string, string>>>(new Map())

  // ── Color scale state ────────────────────────────────────────────────────────
  const [colormapPreset, setColormapPreset] = useState<ColormapPreset>('bwr')
  const [vminOverride,   setVminOverride]   = useState<number | null>(null)
  const [vmaxOverride,   setVmaxOverride]   = useState<number | null>(null)

  // ── Export state ─────────────────────────────────────────────────────────────
  const [exportOpen,    setExportOpen]    = useState(false)
  const [exportW,       setExportW]       = useState(0)   // 0 = auto-init on open
  const [exportH,       setExportH]       = useState(0)
  const [exportLightBg, setExportLightBg] = useState(true)
  const [exportLoading, setExportLoading] = useState(false)

  // ── Session state ────────────────────────────────────────────────────────────
  const [sessionError,  setSessionError]  = useState<string | null>(null)
  const sessionFileRef = useRef<HTMLInputElement>(null)

  // ── URL hash: read on mount, write on changes ─────────────────────────────────
  useEffect(() => {
    const s = parseHashState()
    if (s.dark   !== undefined) setDarkMode(s.dark)
    if (s.cmap   !== undefined) setColormapPreset(s.cmap as ColormapPreset)
    if (s.series !== undefined) setActiveSeries(s.series)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const encoded = encodeHashState({ dark: darkMode, cmap: colormapPreset, series: activeSeries })
    if (encoded !== window.location.hash) {
      window.history.replaceState(null, '', encoded || (window.location.pathname + window.location.search))
    }
  }, [darkMode, colormapPreset, activeSeries])

  // ── Comparison state ─────────────────────────────────────────────────────────
  const [compareOpen,     setCompareOpen]     = useState(false)
  const [annotField,      setAnnotField]      = useState('')
  const [groupAssignments, setGroupAssignments] = useState<Map<string, 'A' | 'B'>>(new Map())
  const [compareTest,     setCompareTest]     = useState<TestName>('ttest')
  const [compareCorr,     setCompareCorr]     = useState<'BH' | 'Bonferroni' | 'none'>('BH')
  const [compareRunning,  setCompareRunning]  = useState(false)
  const [compareProgress, setCompareProgress] = useState(0)
  const [compareResults,  setCompareResults]  = useState<RowResult[] | null>(null)
  const workerRef = useRef<Worker | null>(null)

  // ── Derived: filtered display orders ─────────────────────────────────────────
  // Column filter runs first (on all rows); row filter then uses the resulting
  // column set so that "% empty" for rows is evaluated only over visible columns.

  const displayColOrder = useMemo(() => {
    let order = colOrder

    if (colFilters.size > 0) {
      order = order.filter(dc => {
        for (const [field, allowed] of colFilters) {
          const vec = dataset.colMetadata.getVector(field)
          if (!vec) continue
          const val = vec.values[dc]
          if (val == null || !allowed.has(String(val))) return false
        }
        return true
      })
    }

    for (const rule of colValueFilters) {
      order = order.filter(dc => passesOp(colAgg(dataset, dc, rule.series, rule.aggregate), rule.operator, rule.threshold))
    }

    if (colIdFilter) {
      const idVec = dataset.colMetadata.getVector('id')
      const { ids, mode } = colIdFilter
      order = order.filter(dc => {
        const id = String(idVec?.values[dc] ?? '')
        return mode === 'include' ? ids.has(id) : !ids.has(id)
      })
    }

    return order
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colOrder, colFilters, colValueFilters, colIdFilter, dataset, annotVersion])

  // Row filter runs after column filter — row value aggregates use displayColOrder
  // so that "% empty" is computed only over the columns that are still visible.
  const displayRowOrder = useMemo(() => {
    let order = rowOrder

    if (rowFilters.size > 0) {
      order = order.filter(dr => {
        for (const [field, allowed] of rowFilters) {
          const vec = dataset.rowMetadata.getVector(field)
          if (!vec) continue
          const val = vec.values[dr]
          if (val == null || !allowed.has(String(val))) return false
        }
        return true
      })
    }

    for (const rule of rowValueFilters) {
      order = order.filter(dr =>
        passesOp(rowAggOver(dataset, dr, rule.series, rule.aggregate, displayColOrder), rule.operator, rule.threshold)
      )
    }

    if (rowIdFilter) {
      const idVec = dataset.rowMetadata.getVector('id')
      const { ids, mode } = rowIdFilter
      order = order.filter(dr => {
        const id = String(idVec?.values[dr] ?? '')
        return mode === 'include' ? ids.has(id) : !ids.has(id)
      })
    }

    return order
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowOrder, rowFilters, rowValueFilters, rowIdFilter, displayColOrder, dataset, annotVersion])

  const colorRange = useMemo(
    () => computeColorRange(dataset, activeSeries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, activeSeries],
  )

  // Reset overrides when series or dataset changes
  useEffect(() => { setVminOverride(null); setVmaxOverride(null) }, [dataset, activeSeries])

  const effectiveVmin = vminOverride ?? colorRange[0]
  const effectiveVmax = vmaxOverride ?? colorRange[1]

  const rowIdVec = dataset.rowMetadata.getVector('id')
  const colIdVec = dataset.colMetadata.getVector('id')

  const colAnnotVecs = useMemo(
    () => dataset.colMetadata.vectors.filter(v => v.name !== 'id'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, annotVersion],
  )
  const rowAnnotVecs = useMemo(
    () => dataset.rowMetadata.vectors.filter(v => v.name !== 'id'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, annotVersion],
  )

  // refs — full sort order (used only for sort operations)
  const fullRowOrderRef = useRef(rowOrder)
  useEffect(() => { fullRowOrderRef.current = rowOrder }, [rowOrder])
  const fullColOrderRef = useRef(colOrder)
  useEffect(() => { fullColOrderRef.current = colOrder }, [colOrder])

  // refs — display order (used for tooltip, search, rendering)
  const displayRowOrderRef = useRef(displayRowOrder)
  useEffect(() => { displayRowOrderRef.current = displayRowOrder }, [displayRowOrder])
  const displayColOrderRef = useRef(displayColOrder)
  useEffect(() => { displayColOrderRef.current = displayColOrder }, [displayColOrder])

  const vsRef = useRef(viewState)
  useEffect(() => { vsRef.current = viewState }, [viewState])


  // Auto-select annotation field when compare panel opens
  useEffect(() => {
    if (compareOpen && !annotField && colAnnotVecs.length > 0) {
      setAnnotField(colAnnotVecs[0].name)
    }
  }, [compareOpen, annotField, colAnnotVecs])

  // Comparison group column sets (data-order)
  const { groupACols, groupBCols } = useMemo(() => {
    const vec = colAnnotVecs.find(v => v.name === annotField)
    if (!vec || groupAssignments.size === 0) return { groupACols: [], groupBCols: [] }
    const a: number[] = [], b: number[] = []
    for (let dc = 0; dc < dataset.colCount; dc++) {
      const val = vec.values[dc]
      if (val == null) continue
      const grp = groupAssignments.get(String(val))
      if (grp === 'A') a.push(dc)
      else if (grp === 'B') b.push(dc)
    }
    return { groupACols: a, groupBCols: b }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colAnnotVecs, annotField, groupAssignments, dataset.colCount, annotVersion])

  const groupOverlayValues = useMemo<VectorValue[] | null>(() => {
    if (groupACols.length === 0 && groupBCols.length === 0) return null
    const vals: VectorValue[] = new Array(dataset.colCount).fill(null)
    for (const dc of groupACols) vals[dc] = 'A'
    for (const dc of groupBCols) vals[dc] = 'B'
    return vals
  }, [groupACols, groupBCols, dataset.colCount])

  // ── WebGL init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2')
    if (!gl) { setGlError('WebGL 2 is not supported in this browser.'); return }
    glRef.current = gl
    try {
      progRef.current    = createProgram(gl)
      cmapTexRef.current = uploadColormapTexture(gl)
    } catch (e) { setGlError(String(e)) }
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (dataTexRef.current) gl.deleteTexture(dataTexRef.current.texture)
      if (cmapTexRef.current) gl.deleteTexture(cmapTexRef.current)
      if (progRef.current)    gl.deleteProgram(progRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Re-upload data texture (uses display orders, triggered by texVersion) ────
  useEffect(() => {
    const gl = glRef.current
    if (!gl) return
    if (dataTexRef.current) gl.deleteTexture(dataTexRef.current.texture)
    try {
      dataTexRef.current = uploadDataTexture(
        gl, dataset, activeSeries, displayRowOrder, displayColOrder,
      )
    } catch (e) { setGlError(String(e)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, activeSeries, texVersion])

  // ── Re-upload colormap texture when preset changes ───────────────────────────
  useEffect(() => {
    const gl = glRef.current
    if (!gl) return
    if (cmapTexRef.current) gl.deleteTexture(cmapTexRef.current)
    cmapTexRef.current = uploadColormapTexture(gl, colormapPreset)
  }, [colormapPreset])

  // ── Resize observer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width  = Math.round(width  * dpr)
        canvas.height = Math.round(height * dpr)
      }
      setCanvasSize({ w: width, h: height })
      setViewState(vs => ({
        ...vs,
        cellW: width > 0 && vs.cellW === 60
          ? Math.max(MIN_CELL, width / displayColOrderRef.current.length)
          : vs.cellW,
      }))
    })
    obs.observe(el)
    return () => obs.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── WebGL draw ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const gl      = glRef.current
    const prog    = progRef.current
    const dTexRes = dataTexRef.current
    const cTex    = cmapTexRef.current
    if (!gl || !prog || !dTexRes || !cTex || canvasSize.w === 0) return
    const { texture: dTex, texW, texH, tilingK } = dTexRes
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1
      const pw  = Math.round(canvasSize.w * dpr)
      const ph  = Math.round(canvasSize.h * dpr)
      gl.viewport(0, 0, pw, ph)
      if (darkMode) gl.clearColor(0.06, 0.06, 0.10, 1)
      else          gl.clearColor(1, 1, 1, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(prog)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dTex)
      gl.uniform1i(gl.getUniformLocation(prog, 'u_data'), 0)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cTex)
      gl.uniform1i(gl.getUniformLocation(prog, 'u_colormap'), 1)
      const vs = viewState
      // Use display-order lengths so filtered views render correctly
      gl.uniform2f(gl.getUniformLocation(prog, 'u_dataSize'),   displayColOrder.length, displayRowOrder.length)
      gl.uniform2f(gl.getUniformLocation(prog, 'u_texSize'),    texW, texH)
      gl.uniform1f(gl.getUniformLocation(prog, 'u_tilingK'),    tilingK)
      gl.uniform2f(gl.getUniformLocation(prog, 'u_canvasSize'), pw, ph)
      gl.uniform2f(gl.getUniformLocation(prog, 'u_cellSize'),   vs.cellW * dpr, vs.cellH * dpr)
      gl.uniform2f(gl.getUniformLocation(prog, 'u_offset'),     vs.colOffset, vs.rowOffset)
      gl.uniform1f(gl.getUniformLocation(prog, 'u_vmin'),       effectiveVmin)
      gl.uniform1f(gl.getUniformLocation(prog, 'u_vmax'),       effectiveVmax)
      const [br, bg, bb, ba] = theme.clearColor
      gl.uniform4f(gl.getUniformLocation(prog, 'u_bgColor'),    br, bg, bb, ba)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    })
  }, [canvasSize, viewState, effectiveVmin, effectiveVmax, colormapPreset, dataset, displayRowOrder, displayColOrder, darkMode])

  // ── Sort (operates on full order, filter is applied on top) ──────────────────
  const [lastColSort, setLastColSort] = useState<{ dc: number; dir: 'asc' | 'desc' } | null>(null)
  const [lastRowSort, setLastRowSort] = useState<{ dr: number; dir: 'asc' | 'desc' } | null>(null)
  const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())

  const sortBy = useCallback((axis: 'row' | 'col', fieldName: string, dir: 'asc' | 'desc') => {
    const meta = axis === 'row' ? dataset.rowMetadata : dataset.colMetadata
    const vec  = meta.getVector(fieldName)
    if (!vec) return
    if (axis === 'row') {
      setRowOrder(sortOrder(vec, fullRowOrderRef.current, dir))
    } else {
      setColOrder(sortOrder(vec, fullColOrderRef.current, dir))
    }
    setLastColSort(null)
    setLastRowSort(null)
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, rowOffset: 0, colOffset: 0 }))
  }, [dataset])

  // Sort rows by values in a specific column (clicking a column label)
  const sortRowsByCol = useCallback((dc: number) => {
    const dir = (lastColSort?.dc === dc && lastColSort.dir === 'desc') ? 'asc' : 'desc'
    const sorted = [...fullRowOrderRef.current].sort((a, b) => {
      const va = dataset.getValue(a, dc, activeSeries)
      const vb = dataset.getValue(b, dc, activeSeries)
      if (isNaN(va) && isNaN(vb)) return 0
      if (isNaN(va)) return 1
      if (isNaN(vb)) return -1
      return dir === 'desc' ? vb - va : va - vb
    })
    setRowOrder(sorted)
    setLastColSort({ dc, dir })
    setLastRowSort(null)
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, rowOffset: 0 }))
  }, [dataset, activeSeries, lastColSort])

  // Sort columns by values in a specific row (clicking a gene label)
  const sortColsByRow = useCallback((dr: number) => {
    const dir = (lastRowSort?.dr === dr && lastRowSort.dir === 'desc') ? 'asc' : 'desc'
    const sorted = [...fullColOrderRef.current].sort((a, b) => {
      const va = dataset.getValue(dr, a, activeSeries)
      const vb = dataset.getValue(dr, b, activeSeries)
      if (isNaN(va) && isNaN(vb)) return 0
      if (isNaN(va)) return 1
      if (isNaN(vb)) return -1
      return dir === 'desc' ? vb - va : va - vb
    })
    setColOrder(sorted)
    setLastRowSort({ dr, dir })
    setLastColSort(null)
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, colOffset: 0 }))
  }, [dataset, activeSeries, lastRowSort])

  // Sort rows by sum of values across selected columns
  const sortRowsByColSum = useCallback((dir: 'asc' | 'desc') => {
    if (selectedCols.size === 0) return
    const cols = [...selectedCols]
    const sorted = [...fullRowOrderRef.current].sort((a, b) => {
      let sa = 0, sb = 0
      for (const dc of cols) {
        const va = dataset.getValue(a, dc, activeSeries)
        const vb = dataset.getValue(b, dc, activeSeries)
        if (!isNaN(va)) sa += va
        if (!isNaN(vb)) sb += vb
      }
      return dir === 'desc' ? sb - sa : sa - sb
    })
    setRowOrder(sorted)
    setLastColSort(null)
    setLastRowSort(null)
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, rowOffset: 0 }))
  }, [dataset, activeSeries, selectedCols])

  // Sort columns by sum of values across selected rows
  const sortColsByRowSum = useCallback((dir: 'asc' | 'desc') => {
    if (selectedRows.size === 0) return
    const rows = [...selectedRows]
    const sorted = [...fullColOrderRef.current].sort((a, b) => {
      let sa = 0, sb = 0
      for (const dr of rows) {
        const va = dataset.getValue(dr, a, activeSeries)
        const vb = dataset.getValue(dr, b, activeSeries)
        if (!isNaN(va)) sa += va
        if (!isNaN(vb)) sb += vb
      }
      return dir === 'desc' ? sb - sa : sa - sb
    })
    setColOrder(sorted)
    setLastColSort(null)
    setLastRowSort(null)
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, colOffset: 0 }))
  }, [dataset, activeSeries, selectedRows])

  // ── Filter helpers ────────────────────────────────────────────────────────────
  const quickFilterCol = useCallback((fieldName: string, value: string) => {
    setColFilters(prev => {
      const next = new Map(prev)
      const cur  = next.get(fieldName)
      if (!cur) {
        next.set(fieldName, new Set([value]))
      } else if (cur.size === 1 && cur.has(value)) {
        next.delete(fieldName)
      } else {
        next.set(fieldName, new Set([value]))
      }
      return next
    })
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, colOffset: 0 }))
  }, [])

  const quickFilterRow = useCallback((fieldName: string, value: string) => {
    setRowFilters(prev => {
      const next = new Map(prev)
      const cur  = next.get(fieldName)
      if (!cur) {
        next.set(fieldName, new Set([value]))
      } else if (cur.size === 1 && cur.has(value)) {
        next.delete(fieldName)
      } else {
        next.set(fieldName, new Set([value]))
      }
      return next
    })
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, rowOffset: 0 }))
  }, [])

  const toggleColValue = useCallback((fieldName: string, value: string) => {
    setColFilters(prev => {
      const vec = dataset.colMetadata.getVector(fieldName)
      if (!vec) return prev
      const all  = new Set(uniqueValues(vec))
      const next = new Map(prev)
      const cur  = next.get(fieldName) ?? new Set(all)
      const upd  = new Set(cur)
      upd.has(value) ? upd.delete(value) : upd.add(value)
      if (upd.size === all.size) next.delete(fieldName)
      else next.set(fieldName, upd)
      return next
    })
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, colOffset: 0 }))
  }, [dataset])

  const toggleRowValue = useCallback((fieldName: string, value: string) => {
    setRowFilters(prev => {
      const vec = dataset.rowMetadata.getVector(fieldName)
      if (!vec) return prev
      const all  = new Set(uniqueValues(vec))
      const next = new Map(prev)
      const cur  = next.get(fieldName) ?? new Set(all)
      const upd  = new Set(cur)
      upd.has(value) ? upd.delete(value) : upd.add(value)
      if (upd.size === all.size) next.delete(fieldName)
      else next.set(fieldName, upd)
      return next
    })
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, rowOffset: 0 }))
  }, [dataset])

  const clearColFilter = useCallback((fieldName: string) => {
    setColFilters(prev => { const n = new Map(prev); n.delete(fieldName); return n })
    setTexVersion(v => v + 1)
  }, [])

  const clearRowFilter = useCallback((fieldName: string) => {
    setRowFilters(prev => { const n = new Map(prev); n.delete(fieldName); return n })
    setTexVersion(v => v + 1)
  }, [])

  const clearAllFilters = useCallback(() => {
    setRowFilters(new Map())
    setColFilters(new Map())
    setRowValueFilters([])
    setColValueFilters([])
    setRowIdFilter(null)
    setColIdFilter(null)
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, rowOffset: 0, colOffset: 0 }))
  }, [])

  // ── Export PNG ───────────────────────────────────────────────────────────────
  const exportHeatmapPng = useCallback(() => {
    const nRows = displayRowOrder.length
    const nCols = displayColOrder.length
    if (nRows === 0 || nCols === 0) return
    setExportLoading(true)
    // Defer to next tick so React can re-render the loading state first
    setTimeout(() => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width  = exportW
        canvas.height = exportH
        const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
        if (!gl) { alert('WebGL2 not available for export'); return }
        const prog = createProgram(gl)
        const { texture: dTex, texW, texH, tilingK } = uploadDataTexture(
          gl, dataset, activeSeries, displayRowOrder, displayColOrder,
        )
        const cTex = uploadColormapTexture(gl, colormapPreset)
        gl.viewport(0, 0, exportW, exportH)
        const [cr, cg, cb, ca] = exportLightBg ? LIGHT_THEME.clearColor : DARK_THEME.clearColor
        gl.clearColor(cr, cg, cb, ca)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(prog)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dTex)
        gl.uniform1i(gl.getUniformLocation(prog, 'u_data'), 0)
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cTex)
        gl.uniform1i(gl.getUniformLocation(prog, 'u_colormap'), 1)
        gl.uniform2f(gl.getUniformLocation(prog, 'u_dataSize'),   nCols, nRows)
        gl.uniform2f(gl.getUniformLocation(prog, 'u_texSize'),    texW, texH)
        gl.uniform1f(gl.getUniformLocation(prog, 'u_tilingK'),    tilingK)
        gl.uniform2f(gl.getUniformLocation(prog, 'u_canvasSize'), exportW, exportH)
        gl.uniform2f(gl.getUniformLocation(prog, 'u_cellSize'),   exportW / nCols, exportH / nRows)
        gl.uniform2f(gl.getUniformLocation(prog, 'u_offset'),     0, 0)
        gl.uniform1f(gl.getUniformLocation(prog, 'u_vmin'),       effectiveVmin)
        gl.uniform1f(gl.getUniformLocation(prog, 'u_vmax'),       effectiveVmax)
        gl.uniform4f(gl.getUniformLocation(prog, 'u_bgColor'),    cr, cg, cb, ca)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        const seriesName = dataset.seriesNames[activeSeries] ?? 'heatmap'
        const filename   = `heatmap_${nRows}x${nCols}_${seriesName}.png`
        canvas.toBlob(blob => {
          if (!blob) return
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = filename
          a.click(); URL.revokeObjectURL(url)
        }, 'image/png')
        gl.deleteTexture(dTex); gl.deleteTexture(cTex); gl.deleteProgram(prog)
      } finally {
        setExportLoading(false)
        setExportOpen(false)
      }
    }, 30)
  }, [dataset, activeSeries, displayRowOrder, displayColOrder, effectiveVmin, effectiveVmax, colormapPreset, exportW, exportH, exportLightBg])

  // ── Export GCT ───────────────────────────────────────────────────────────────
  const exportGct = useCallback(() => {
    const gct      = writeGctV12(dataset, displayRowOrder, displayColOrder, activeSeries)
    const series   = dataset.seriesNames[activeSeries] ?? 'data'
    const filename = `heatmap_${displayRowOrder.length}x${displayColOrder.length}_${series}.gct`
    downloadText(gct, filename)
  }, [dataset, displayRowOrder, displayColOrder, activeSeries])

  // ── Save session ──────────────────────────────────────────────────────────────
  const saveSession = useCallback(() => {
    const session = buildSession(dataset, {
      darkMode,
      colormapPreset,
      vminOverride,
      vmaxOverride,
      activeSeries,
      rowOrder:         [...rowOrder],
      colOrder:         [...colOrder],
      visColTracks:     [...visColTracks],
      visRowTracks:     [...visRowTracks],
      trackDisplayModes: [...trackDisplayModes],
      customColors:     [...customColors].map(([k, v]) => [k, [...v]] as [string, [string, string][]]),
      rowFilters:       [...rowFilters].map(([k, v]) => [k, [...v]]),
      colFilters:       [...colFilters].map(([k, v]) => [k, [...v]]),
      rowValueFilters:  [...rowValueFilters],
      colValueFilters:  [...colValueFilters],
      rowIdFilter:      serializeIdFilter(rowIdFilter),
      colIdFilter:      serializeIdFilter(colIdFilter),
    })
    downloadSession(session)
  }, [
    dataset, darkMode, colormapPreset, vminOverride, vmaxOverride,
    activeSeries, rowOrder, colOrder,
    visColTracks, visRowTracks, trackDisplayModes, customColors,
    rowFilters, colFilters, rowValueFilters, colValueFilters, rowIdFilter, colIdFilter,
  ])

  // ── Load session ──────────────────────────────────────────────────────────────
  const loadSession = useCallback(async (file: File) => {
    setSessionError(null)
    try {
      const session: GitoolsSession = await parseSessionFile(file)
      const info = session.dataInfo
      if (info.rowCount !== dataset.rowCount || info.colCount !== dataset.colCount) {
        throw new Error(
          `Session is for a ${info.rowCount}×${info.colCount} matrix but current data is ` +
          `${dataset.rowCount}×${dataset.colCount}. Load the matching data file first.`
        )
      }

      // Restore any annotations from the session that aren't already present
      let annotAdded = false
      for (const ann of session.annotations) {
        const meta = ann.axis === 'row' ? dataset.rowMetadata : dataset.colMetadata
        const existing = meta.getVector(ann.name)
        if (existing) {
          // Overwrite values in-place so we don't duplicate the vector
          ann.values.forEach((v, i) => { existing.values[i] = v })
        } else {
          const vec = meta.addVector(ann.name, ann.dataType)
          ann.values.forEach((v, i) => { vec.values[i] = v })
          annotAdded = true
        }
      }
      if (annotAdded) setAnnotVersion(v => v + 1)

      // Apply view state
      const vs = session.viewState
      setDarkMode(vs.darkMode)
      setColormapPreset(vs.colormapPreset as ColormapPreset)
      setVminOverride(vs.vminOverride)
      setVmaxOverride(vs.vmaxOverride)
      setActiveSeries(vs.activeSeries)
      setRowOrder(vs.rowOrder)
      setColOrder(vs.colOrder)
      setVisColTracks(new Set(vs.visColTracks))
      setVisRowTracks(new Set(vs.visRowTracks))
      setTrackDisplayModes(new Map(vs.trackDisplayModes))
      setCustomColors(new Map(vs.customColors.map(([k, v]) => [k, new Map(v)])))
      setRowFilters(new Map(vs.rowFilters.map(([k, v]) => [k, new Set(v)])))
      setColFilters(new Map(vs.colFilters.map(([k, v]) => [k, new Set(v)])))
      // Value filters and ID-list filters are temporary search tools — deliberately
      // not restored, because they commonly cause an "empty" view when the IDs or
      // thresholds no longer match the freshly loaded dataset.
      setRowValueFilters([])
      setColValueFilters([])
      setRowIdFilter(null)
      setColIdFilter(null)
      setTexVersion(v => v + 1)
      setViewState(prev => ({ ...prev, rowOffset: 0, colOffset: 0 }))
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : String(err))
    }
  }, [dataset])

  // ── Clamp (uses display counts) ───────────────────────────────────────────────
  const clampOffset = useCallback((vs: ViewState, co: number, ro: number, w: number, h: number) => ({
    colOffset: Math.max(0, Math.min(Math.max(0, displayColOrderRef.current.length - w / vs.cellW), co)),
    rowOffset: Math.max(0, Math.min(Math.max(0, displayRowOrderRef.current.length - h / vs.cellH), ro)),
  }), [])

  // ── Pan ──────────────────────────────────────────────────────────────────────
  const dragRef = useRef<{ sx: number; sy: number; sco: number; sro: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const vs = vsRef.current
    dragRef.current = { sx: e.clientX, sy: e.clientY, sco: vs.colOffset, sro: vs.rowOffset }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(true); setTooltip(null)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const vs = vsRef.current
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.sx
      const dy = e.clientY - dragRef.current.sy
      setViewState(prev => ({
        ...prev,
        ...clampOffset(prev,
          dragRef.current!.sco - dx / vs.cellW,
          dragRef.current!.sro - dy / vs.cellH,
          canvasSize.w, canvasSize.h),
      }))
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const vc = Math.floor(vs.colOffset + x / vs.cellW)
    const vr = Math.floor(vs.rowOffset + y / vs.cellH)
    const dro = displayRowOrderRef.current
    const dco = displayColOrderRef.current
    if (vc >= 0 && vc < dco.length && vr >= 0 && vr < dro.length) {
      const dr = dro[vr]
      const dc = dco[vc]
      setTooltip({
        clientX: e.clientX, clientY: e.clientY,
        gene:   (rowIdVec?.values[dr] as string | null) ?? `Row ${dr}`,
        sample: (colIdVec?.values[dc] as string | null) ?? `Col ${dc}`,
        values: dataset.seriesNames.map((_, s) => dataset.getValue(dr, dc, s)),
      })
    } else { setTooltip(null) }
  }, [canvasSize, clampOffset, dataset, rowIdVec, colIdVec])

  const onPointerUp    = useCallback(() => { dragRef.current = null; setDrag(false) }, [])
  const onPointerLeave = useCallback(() => { dragRef.current = null; setDrag(false); setTooltip(null) }, [])

  // ── Wheel ────────────────────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const vs = vsRef.current
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.14 : 0.88
      const rect   = e.currentTarget.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const newCW = Math.max(MIN_CELL, Math.min(MAX_CELL, vs.cellW * factor))
      const newCH = Math.max(MIN_CELL, Math.min(MAX_CELL, vs.cellH * factor))
      setViewState(prev => ({
        cellW: newCW, cellH: newCH,
        ...clampOffset({ ...prev, cellW: newCW, cellH: newCH },
          vs.colOffset + mx / vs.cellW - mx / newCW,
          vs.rowOffset + my / vs.cellH - my / newCH,
          canvasSize.w, canvasSize.h),
      }))
    } else if (e.shiftKey) {
      const delta = (e.deltaY !== 0 ? e.deltaY : e.deltaX) / vs.cellW
      setViewState(prev => ({ ...prev, ...clampOffset(prev, vs.colOffset + delta, vs.rowOffset, canvasSize.w, canvasSize.h) }))
    } else {
      const delta = e.deltaY / vs.cellH
      setViewState(prev => ({ ...prev, ...clampOffset(prev, vs.colOffset, vs.rowOffset + delta, canvasSize.w, canvasSize.h) }))
    }
  }, [canvasSize, clampOffset])

  // ── Search (searches within display order) ───────────────────────────────────
  const handleSearch = useCallback((q: string) => {
    setSearch(q)
    if (!q.trim() || !rowIdVec) {
      setHighlightedRows(new Set())
      return
    }
    const lower = q.toLowerCase()
    const matched = new Set<number>()
    let firstVR = -1
    displayRowOrderRef.current.forEach((dr, vr) => {
      const id = rowIdVec.values[dr]
      if (id != null && String(id).toLowerCase().includes(lower)) {
        matched.add(dr)
        if (firstVR < 0) firstVR = vr
      }
    })
    setHighlightedRows(matched)
    if (firstVR >= 0) {
      setViewState(vs => ({ ...vs, rowOffset: Math.max(0, firstVR - 3) }))
    }
  }, [rowIdVec])

  // ── Annotation file drop ─────────────────────────────────────────────────────
  const onAnnotDrop = useCallback(async (e: DragEvent<HTMLDivElement>, axis: 'row' | 'col') => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    setAnnotLoading(true); setAnnotError(null)
    try {
      const added = await loadAnnotationTsv(file, dataset, axis)
      if (added === 0) throw new Error('No new annotation fields matched the matrix IDs.')
      const vecs   = axis === 'row' ? dataset.rowMetadata.vectors : dataset.colMetadata.vectors
      const setter = axis === 'row' ? setVisRowTracks : setVisColTracks
      const names  = vecs.slice(-added).map(v => v.name)
      setter(prev => { const s = new Set(prev); names.forEach(n => s.add(n)); return s })
      setAnnotVersion(v => v + 1)
    } catch (err) {
      setAnnotError(err instanceof Error ? err.message : String(err))
    } finally { setAnnotLoading(false) }
  }, [dataset])

  // ── Comparison: run ──────────────────────────────────────────────────────────
  const runComparison = useCallback(() => {
    if (compareRunning || groupACols.length === 0 || groupBCols.length === 0) return
    workerRef.current?.terminate()

    const worker = new Worker(
      new URL('../../stats/statsWorker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    const rowNames = (rowIdVec?.values ?? []).map(v => v != null ? String(v) : '')
    while (rowNames.length < dataset.rowCount) rowNames.push(`Row ${rowNames.length}`)

    const valuesCopy = new Float32Array(dataset.getSeriesArray(activeSeries))

    const request: WorkerRequest = {
      type: 'run',
      values:     valuesCopy,
      rowCount:   dataset.rowCount,
      colCount:   dataset.colCount,
      rowNames,
      groupACols,
      groupBCols,
      test:       compareTest,
      correction: compareCorr,
    }

    setCompareRunning(true)
    setCompareProgress(0)
    setCompareResults(null)

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'progress')      setCompareProgress(msg.pct)
      else if (msg.type === 'done')   { setCompareRunning(false); setCompareResults(msg.results); worker.terminate() }
      else if (msg.type === 'error')  { setCompareRunning(false); setAnnotError(`Comparison error: ${msg.message}`); worker.terminate() }
    }

    worker.postMessage(request, [valuesCopy.buffer])
  }, [compareRunning, groupACols, groupBCols, dataset, activeSeries, rowIdVec, compareTest, compareCorr])

  // ── Gene highlight from results ──────────────────────────────────────────────
  const onGeneClick = useCallback((rowIndex: number) => {
    setHighlightedRows(new Set([rowIndex]))
    const vr = displayRowOrderRef.current.indexOf(rowIndex)
    if (vr >= 0) {
      setViewState(vs => ({
        ...vs,
        rowOffset: Math.max(0, vr - Math.floor(canvasSize.h / vs.cellH / 2)),
      }))
    }
  }, [canvasSize])

  // ── Add results as row annotations ───────────────────────────────────────────
  const onAddAnnotations = useCallback((results: RowResult[]) => {
    const hasPVal = results.some(r => !isNaN(r.pvalue))
    const scoreVec = dataset.rowMetadata.addVector('cmp_score', 'number')
    results.forEach(r => { scoreVec.values[r.rowIndex] = r.score })
    if (hasPVal) {
      const fdrVec = dataset.rowMetadata.addVector('cmp_FDR', 'number')
      results.forEach(r => { fdrVec.values[r.rowIndex] = r.fdr })
    }
    setAnnotVersion(v => v + 1)
    setVisRowTracks(prev => {
      const s = new Set(prev); s.add('cmp_score'); if (hasPVal) s.add('cmp_FDR'); return s
    })
  }, [dataset])

  // ── Comparison field / group helpers ─────────────────────────────────────────
  const handleFieldChange = useCallback((field: string) => {
    setAnnotField(field); setGroupAssignments(new Map()); setCompareResults(null)
  }, [])

  const assignGroup = useCallback((value: string, grp: 'A' | 'B' | null) => {
    setGroupAssignments(prev => {
      const next = new Map(prev)
      grp === null ? next.delete(value) : next.set(value, grp)
      return next
    })
    setCompareResults(null)
  }, [])

  // ── Visible ranges (use display lengths) ─────────────────────────────────────
  const vs       = viewState
  const nRows    = displayRowOrder.length
  const nCols    = displayColOrder.length
  const startRow = Math.max(0, Math.floor(vs.rowOffset))
  const endRow   = Math.min(nRows, Math.ceil(vs.rowOffset + canvasSize.h / vs.cellH) + 1)
  const startCol = Math.max(0, Math.floor(vs.colOffset))
  const endCol   = Math.min(nCols, Math.ceil(vs.colOffset + canvasSize.w / vs.cellW) + 1)
  const showRowLbl = vs.cellH >= 8

  const seriesCount   = dataset.getSeriesCount()
  const colAnnotShown = colAnnotVecs.filter(v => visColTracks.has(v.name))
  const rowAnnotShown = rowAnnotVecs.filter(v => visRowTracks.has(v.name))
  const rowAnnotWidth = rowAnnotShown.reduce(
    (sum, vec) => sum + (trackDisplayModes.get(vec.name) === 'text' ? TEXT_TRACK_W : TRACK_W), 0,
  )

  const effectiveColorMaps = useMemo(() => {
    const m = new Map<string, Map<string, string>>()
    ;[...colAnnotVecs, ...rowAnnotVecs].forEach(v => {
      if (v.dataType === 'string') {
        const base   = buildCategoryColors(v.values)
        const custom = customColors.get(v.name)
        if (custom?.size) {
          const merged = new Map(base)
          custom.forEach((col, cat) => merged.set(cat, col))
          m.set(v.name, merged)
        } else {
          m.set(v.name, base)
        }
      }
    })
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, annotVersion, customColors])

  const hasPValue  = TEST_OPTIONS.find(t => t.value === compareTest)?.hasPValue ?? true
  const anyFilters = rowFilters.size > 0 || colFilters.size > 0
    || rowValueFilters.length > 0 || colValueFilters.length > 0
    || rowIdFilter !== null || colIdFilter !== null

  // Callbacks for FilterPanel — each increments texVersion to re-upload the data texture
  const handleRowValueFiltersChange = useCallback((rules: ValueFilterRule[]) => {
    setRowValueFilters(rules); setTexVersion(v => v + 1); setViewState(vs => ({ ...vs, rowOffset: 0 }))
  }, [])
  const handleColValueFiltersChange = useCallback((rules: ValueFilterRule[]) => {
    setColValueFilters(rules); setTexVersion(v => v + 1); setViewState(vs => ({ ...vs, colOffset: 0 }))
  }, [])
  const handleRowIdFilterChange = useCallback((f: IdFilterConfig | null) => {
    setRowIdFilter(f); setTexVersion(v => v + 1); setViewState(vs => ({ ...vs, rowOffset: 0 }))
  }, [])
  const handleColIdFilterChange = useCallback((f: IdFilterConfig | null) => {
    setColIdFilter(f); setTexVersion(v => v + 1); setViewState(vs => ({ ...vs, colOffset: 0 }))
  }, [])

  const handleToggleDisplayMode = useCallback((name: string) => {
    setTrackDisplayModes(prev => {
      const next = new Map(prev)
      next.get(name) === 'text' ? next.delete(name) : next.set(name, 'text')
      return next
    })
  }, [])

  const handleColorChange = useCallback((fieldName: string, category: string, color: string) => {
    setCustomColors(prev => {
      const next     = new Map(prev)
      const fieldMap = new Map(next.get(fieldName) ?? [])
      fieldMap.set(category, color)
      next.set(fieldName, fieldMap)
      return next
    })
  }, [])

  const searchBorderColor = search.trim()
    ? (highlightedRows.size > 0 ? '#f59e0b' : '#ef4444')
    : (darkMode ? '#2a2a45' : '#e0e0e0')

  if (glError) return (
    <div className="flex items-center justify-center h-full text-red-400 text-sm font-mono p-8">{glError}</div>
  )

  return (
    <div className="flex h-full" style={{ background: theme.bg }}>

      {/* ── Left sidebar ── */}
      <div
        className="shrink-0 flex flex-col border-r border-[--color-border] transition-all"
        style={{ width: sidebarOpen ? 220 : 0, overflow: 'hidden', background: theme.surface }}
      >
        {sidebarOpen && (
          <div className="p-2 overflow-y-auto flex-1 text-xs font-mono">
            <SidebarSection
              title="Column annotations"
              vecs={colAnnotVecs}
              visible={visColTracks}
              onToggle={n => setVisColTracks(s => { const c = new Set(s); c.has(n) ? c.delete(n) : c.add(n); return c })}
              onSelectAll={() => setVisColTracks(new Set(colAnnotVecs.map(v => v.name)))}
              onDeselectAll={() => setVisColTracks(new Set())}
              onSort={(n, d) => sortBy('col', n, d)}
              onDrop={e => onAnnotDrop(e, 'col')}
              loading={annotLoading}
              filters={colFilters}
              onToggleValue={toggleColValue}
              onClearFilter={clearColFilter}
              theme={theme}
              trackDisplayModes={trackDisplayModes}
              onToggleDisplayMode={handleToggleDisplayMode}
              colorMaps={effectiveColorMaps}
              onColorChange={handleColorChange}
            />
            <SidebarSection
              title="Row annotations"
              vecs={rowAnnotVecs}
              visible={visRowTracks}
              onToggle={n => setVisRowTracks(s => { const c = new Set(s); c.has(n) ? c.delete(n) : c.add(n); return c })}
              onSelectAll={() => setVisRowTracks(new Set(rowAnnotVecs.map(v => v.name)))}
              onDeselectAll={() => setVisRowTracks(new Set())}
              onSort={(n, d) => sortBy('row', n, d)}
              onDrop={e => onAnnotDrop(e, 'row')}
              loading={annotLoading}
              filters={rowFilters}
              onToggleValue={toggleRowValue}
              onClearFilter={clearRowFilter}
              theme={theme}
              trackDisplayModes={trackDisplayModes}
              onToggleDisplayMode={handleToggleDisplayMode}
              colorMaps={effectiveColorMaps}
              onColorChange={handleColorChange}
            />
          </div>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── Top controls bar ── */}
        <div className="flex items-center gap-2 px-2 py-1 shrink-0 border-b border-[--color-border]"
          style={{ background: theme.surface }}>
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="text-xs px-2 py-0.5 rounded border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text]"
            title="Toggle annotation sidebar — drag a TSV or CLS file onto it to add row or column annotations"
          >
            {sidebarOpen ? '◀ Annotations' : '▶ Annotations'}
          </button>
          {seriesCount > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-[--color-text-muted]">Series:</span>
              {dataset.seriesNames.map((name, i) => {
                const s = i === activeSeries ? theme.seriesActive : theme.seriesIdle
                return (
                  <button key={i} onClick={() => setActiveSeries(i)}
                    title={`Switch heatmap coloring to the "${name}" data layer`}
                    className="px-2 py-0.5 rounded text-xs font-mono transition-colors"
                    style={{ background: s.background, color: s.color, border: `1px solid ${s.borderColor}` }}>
                    {name}
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex-1" />
          <input
            type="text"
            placeholder="Search gene…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            title="Type a gene name to highlight matching rows and scroll to the first match"
            className="px-2 py-0.5 rounded text-xs font-mono bg-[--color-bg] text-[--color-text] outline-none w-36"
            style={{ border: `1px solid ${searchBorderColor}` }}
          />
          <button
            onClick={() => setFilterPanelOpen(o => !o)}
            title="Filter rows or columns by value, % empty, or an ID list"
            className="text-xs px-2 py-0.5 rounded border transition-colors"
            style={filterPanelOpen
              ? { background: theme.cmpActive.background, color: theme.cmpActive.color, borderColor: theme.cmpActive.borderColor }
              : { background: theme.cmpIdle.background,   color: theme.cmpIdle.color,   borderColor: theme.cmpIdle.borderColor }}
          >
            {'⚗ Filter'}
            {(rowValueFilters.length + colValueFilters.length + (rowIdFilter ? 1 : 0) + (colIdFilter ? 1 : 0)) > 0 && (
              <span className="ml-1 font-semibold">
                ({rowValueFilters.length + colValueFilters.length + (rowIdFilter ? 1 : 0) + (colIdFilter ? 1 : 0)})
              </span>
            )}
          </button>
          <button
            onClick={() => setCompareOpen(o => !o)}
            title="Define Group A and Group B from an annotation field, then run a statistical test per gene"
            className="text-xs px-2 py-0.5 rounded border transition-colors"
            style={compareOpen
              ? { background: theme.cmpActive.background, color: theme.cmpActive.color, borderColor: theme.cmpActive.borderColor }
              : { background: theme.cmpIdle.background,   color: theme.cmpIdle.color,   borderColor: theme.cmpIdle.borderColor }}
          >
            ⚖ Compare Groups
          </button>
          <button
            onClick={() => {
              // Set sensible defaults based on current data dimensions
              const nRows = displayRowOrder.length
              const nCols = displayColOrder.length
              if (exportW === 0) {
                setExportW(Math.min(4000, Math.max(400, nCols * 8)))
                setExportH(Math.min(16000, Math.max(400, nRows * 2)))
              }
              setExportOpen(o => !o)
            }}
            className="text-xs px-2 py-0.5 rounded border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text] transition-colors"
            title="Download the heatmap as a PNG image — set pixel dimensions in the dialog. Exports the active series, current filtered view."
          >
            ↓ Export PNG
          </button>
          <button
            onClick={exportGct}
            className="text-xs px-2 py-0.5 rounded border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text] transition-colors"
            title="Download the current filtered view as a GCT v1.2 file (tab-separated matrix). Exports the active series only, visible rows and columns in their current sort order. Open in Morpheus, GSEA, R, or Python."
          >
            ↓ Export GCT
          </button>
          <button
            onClick={saveSession}
            className="text-xs px-2 py-0.5 rounded border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text] transition-colors"
            title="Save view state to a JSON file: sort order, annotation tracks, color settings, and annotation-based filters. Does NOT save the matrix data — reload your data file before restoring a session."
          >
            ↓ Save Session
          </button>
          <button
            onClick={() => sessionFileRef.current?.click()}
            className="text-xs px-2 py-0.5 rounded border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text] transition-colors"
            title="Restore a saved session JSON. You must load your data file first — the session restores sort order, annotations, colors, and filters, but not the matrix values."
          >
            ↑ Load Session
          </button>
          <button
            onClick={() => setDarkMode(d => !d)}
            className="text-xs px-2 py-0.5 rounded border border-[--color-border] text-[--color-text-muted] hover:text-[--color-text] transition-colors"
            title="Toggle light/dark background"
          >
            {darkMode ? 'Light' : 'Dark'}
          </button>
        </div>

        {/* ── Active filter status bar ── */}
        {anyFilters && (
          <div className="flex items-center gap-2 px-3 py-0.5 shrink-0 text-[10px] font-mono border-b border-[--color-border] flex-wrap"
            style={{ background: theme.surface2 }}>
            <span style={{ color: theme.filterColor }}>Filters active:</span>
            {[...colFilters.entries()].map(([field, vals]) => (
              <span key={`c:${field}`} className="flex items-center gap-1"
                style={{ color: theme.filterColor }}>
                col:{field} ({vals.size})
                <button onClick={() => clearColFilter(field)} className="hover:opacity-70">×</button>
              </span>
            ))}
            {[...rowFilters.entries()].map(([field, vals]) => (
              <span key={`r:${field}`} className="flex items-center gap-1"
                style={{ color: theme.filterColor }}>
                row:{field} ({vals.size})
                <button onClick={() => clearRowFilter(field)} className="hover:opacity-70">×</button>
              </span>
            ))}
            {rowValueFilters.map(r => (
              <span key={`rv:${r.id}`} className="flex items-center gap-1"
                style={{ color: theme.filterColor }}>
                row {r.aggregate} {OP_LABELS[r.operator]} {r.threshold}
                <button onClick={() => handleRowValueFiltersChange(rowValueFilters.filter(x => x.id !== r.id))} className="hover:opacity-70">×</button>
              </span>
            ))}
            {colValueFilters.map(r => (
              <span key={`cv:${r.id}`} className="flex items-center gap-1"
                style={{ color: theme.filterColor }}>
                col {r.aggregate} {OP_LABELS[r.operator]} {r.threshold}
                <button onClick={() => handleColValueFiltersChange(colValueFilters.filter(x => x.id !== r.id))} className="hover:opacity-70">×</button>
              </span>
            ))}
            {rowIdFilter && (
              <span className="flex items-center gap-1" style={{ color: theme.filterColor }}>
                rows: {rowIdFilter.ids.size} IDs ({rowIdFilter.mode})
                <button onClick={() => handleRowIdFilterChange(null)} className="hover:opacity-70">×</button>
              </span>
            )}
            {colIdFilter && (
              <span className="flex items-center gap-1" style={{ color: theme.filterColor }}>
                cols: {colIdFilter.ids.size} IDs ({colIdFilter.mode})
                <button onClick={() => handleColIdFilterChange(null)} className="hover:opacity-70">×</button>
              </span>
            )}
            <span className="text-[--color-text-muted] ml-1">
              — {nRows} rows, {nCols} cols shown
            </span>
            <button onClick={clearAllFilters}
              className="ml-auto underline text-[--color-text-muted]">
              Clear all
            </button>
          </div>
        )}

        {/* ── Sum-sort selection bar ── */}
        {(selectedCols.size > 0 || selectedRows.size > 0) && (
          <div className="flex items-center gap-3 px-3 py-0.5 shrink-0 text-[10px] font-mono border-b border-[--color-border]"
            style={{ background: theme.surface2 }}>
            {selectedCols.size > 0 && (
              <span className="flex items-center gap-1.5">
                <span style={{ color: theme.checkActive }}>
                  {selectedCols.size} col{selectedCols.size > 1 ? 's' : ''} selected
                </span>
                <span style={{ color: theme.textMuted }}>— sort rows by sum:</span>
                <button
                  onClick={() => sortRowsByColSum('desc')}
                  className="px-1 rounded hover:opacity-70"
                  style={{ color: theme.checkActive, border: `1px solid ${theme.checkBorder}` }}
                  title="Sort rows descending by sum across selected columns"
                >↓ high→low</button>
                <button
                  onClick={() => sortRowsByColSum('asc')}
                  className="px-1 rounded hover:opacity-70"
                  style={{ color: theme.checkActive, border: `1px solid ${theme.checkBorder}` }}
                  title="Sort rows ascending by sum across selected columns"
                >↑ low→high</button>
                <button
                  onClick={() => setSelectedCols(new Set())}
                  className="hover:opacity-70"
                  style={{ color: theme.textMuted }}
                  title="Clear column selection"
                >× clear</button>
              </span>
            )}
            {selectedCols.size > 0 && selectedRows.size > 0 && (
              <span style={{ color: theme.textMuted }}>│</span>
            )}
            {selectedRows.size > 0 && (
              <span className="flex items-center gap-1.5">
                <span style={{ color: theme.checkActive }}>
                  {selectedRows.size} row{selectedRows.size > 1 ? 's' : ''} selected
                </span>
                <span style={{ color: theme.textMuted }}>— sort cols by sum:</span>
                <button
                  onClick={() => sortColsByRowSum('desc')}
                  className="px-1 rounded hover:opacity-70"
                  style={{ color: theme.checkActive, border: `1px solid ${theme.checkBorder}` }}
                  title="Sort columns descending by sum across selected rows"
                >↓ high→low</button>
                <button
                  onClick={() => sortColsByRowSum('asc')}
                  className="px-1 rounded hover:opacity-70"
                  style={{ color: theme.checkActive, border: `1px solid ${theme.checkBorder}` }}
                  title="Sort columns ascending by sum across selected rows"
                >↑ low→high</button>
                <button
                  onClick={() => setSelectedRows(new Set())}
                  className="hover:opacity-70"
                  style={{ color: theme.textMuted }}
                  title="Clear row selection"
                >× clear</button>
              </span>
            )}
          </div>
        )}

        {/* ── Group overlay strip ── */}
        {groupOverlayValues && (
          <div className="flex shrink-0" style={{ marginLeft: ROW_LABEL_W + rowAnnotWidth }}>
            <div className="flex-1 relative overflow-hidden" style={{ height: TRACK_H + 2 }}>
              <ColAnnotationTrack
                values={groupOverlayValues}
                colOrder={displayColOrder}
                colOffset={vs.colOffset}
                cellW={vs.cellW}
                height={TRACK_H}
                colors={GROUP_COLORS}
              />
              <div className="absolute left-1 top-0 text-[9px] pointer-events-none"
                style={{ color: theme.textMuted, lineHeight: '12px' }}>groups</div>
            </div>
          </div>
        )}

        {/* ── Column annotation tracks (stacked vertically, one row per field) ── */}
        {colAnnotShown.length > 0 && (
          <div className="flex flex-col shrink-0" style={{ marginLeft: ROW_LABEL_W + rowAnnotWidth }}>
            {colAnnotShown.map(vec => {
              const hasFilter  = colFilters.has(vec.name)
              const trackMode  = trackDisplayModes.get(vec.name) ?? 'color'
              const trackH     = trackMode === 'text' ? TEXT_TRACK_H : TRACK_H
              return (
                <div key={vec.name}
                  className="relative overflow-hidden"
                  style={{ height: trackH, cursor: 'pointer' }}
                  title={`Click to filter columns by ${vec.name}`}
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const vc   = Math.floor(vs.colOffset + (e.clientX - rect.left) / vs.cellW)
                    if (vc >= 0 && vc < displayColOrder.length) {
                      const val = vec.values[displayColOrder[vc]]
                      if (val != null) quickFilterCol(vec.name, String(val))
                    }
                  }}
                >
                  <ColAnnotationTrack
                    values={vec.values}
                    colOrder={displayColOrder}
                    colOffset={vs.colOffset}
                    cellW={vs.cellW}
                    height={trackH}
                    colors={effectiveColorMaps.get(vec.name)}
                    displayMode={trackMode}
                    textColor={theme.labelColor}
                  />
                  <div className="absolute left-1 top-0 text-[9px] leading-tight truncate pointer-events-none"
                    style={{ maxWidth: 80, color: hasFilter ? theme.filterColor : theme.textMuted }}>
                    {vec.name}{hasFilter ? ' ▼' : ''}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Col labels row ── */}
        <div className="flex shrink-0" style={{ height: COL_LABEL_H }}>
          <div style={{ width: ROW_LABEL_W + rowAnnotWidth, minWidth: ROW_LABEL_W + rowAnnotWidth }} />
          <div className="relative flex-1 overflow-hidden border-b border-[--color-border]">
            {Array.from({ length: endCol - startCol }, (_, i) => {
              const vc         = startCol + i
              const dc         = displayColOrder[vc]
              const cx         = (vc - vs.colOffset) * vs.cellW + vs.cellW / 2
              const label      = (colIdVec?.values[dc] as string | null) ?? `S${dc}`
              const isActive   = lastColSort?.dc === dc
              const isSelected = selectedCols.has(dc)
              const arrow      = isActive ? (lastColSort.dir === 'desc' ? ' ▼' : ' ▲') : ''
              const selMark    = isSelected ? ' ●' : ''
              return (
                <div key={vc}
                  className="absolute text-xs font-mono cursor-pointer select-none hover:opacity-80"
                  style={{
                    left: cx, bottom: 6,
                    transform: 'rotate(-55deg)', transformOrigin: 'left bottom',
                    whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden',
                    color: isActive ? theme.labelHighlight : isSelected ? theme.checkActive : theme.textMuted,
                    fontWeight: isActive || isSelected ? 'bold' : 'normal',
                  }}
                  onClick={e => {
                    if (e.shiftKey) {
                      setSelectedCols(prev => {
                        const next = new Set(prev)
                        next.has(dc) ? next.delete(dc) : next.add(dc)
                        return next
                      })
                    } else {
                      sortRowsByCol(dc)
                    }
                  }}
                  title={`Click: sort genes by ${label} · Shift+click: select for sum-sort`}
                >
                  {label}{arrow}{selMark}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Middle: row labels + annotation tracks + canvas ── */}
        <div className="flex flex-1 min-h-0">

          {/* Row label strip */}
          <div className="relative shrink-0 overflow-hidden border-r border-[--color-border]"
            style={{ width: ROW_LABEL_W, background: theme.bg }}>
            {showRowLbl && Array.from({ length: endRow - startRow }, (_, i) => {
              const vr         = startRow + i
              const dr         = displayRowOrder[vr]
              const cy         = (vr - vs.rowOffset) * vs.cellH + vs.cellH / 2
              const label      = (rowIdVec?.values[dr] as string | null) ?? `R${dr}`
              const isMatch    = highlightedRows.has(dr)
              const isActive   = lastRowSort?.dr === dr
              const isSelected = selectedRows.has(dr)
              const arrow      = isActive ? (lastRowSort.dir === 'desc' ? '▼ ' : '▲ ') : ''
              const selMark    = isSelected ? '● ' : ''
              return (
                <div key={vr}
                  className="absolute right-2 font-mono truncate cursor-pointer select-none hover:opacity-80"
                  style={{
                    top: cy, maxWidth: ROW_LABEL_W - 10, transform: 'translateY(-50%)',
                    lineHeight: 1, fontSize: Math.min(12, vs.cellH * 0.75),
                    color:      isMatch || isActive ? theme.labelHighlight
                              : isSelected          ? theme.checkActive
                              : theme.labelColor,
                    fontWeight: isMatch || isActive || isSelected ? 'bold' : 'normal',
                  }}
                  onClick={e => {
                    if (e.shiftKey) {
                      setSelectedRows(prev => {
                        const next = new Set(prev)
                        next.has(dr) ? next.delete(dr) : next.add(dr)
                        return next
                      })
                    } else {
                      sortColsByRow(dr)
                    }
                  }}
                  title={`Click: sort samples by ${label} · Shift+click: select for sum-sort`}
                >
                  {selMark}{arrow}{label}
                </div>
              )
            })}
          </div>

          {/* Row annotation tracks */}
          {rowAnnotShown.map(vec => {
            const hasFilter = rowFilters.has(vec.name)
            const trackMode = trackDisplayModes.get(vec.name) ?? 'color'
            const trackW    = trackMode === 'text' ? TEXT_TRACK_W : TRACK_W
            return (
              <div key={vec.name}
                className="relative shrink-0 overflow-hidden"
                style={{ width: trackW, cursor: 'pointer' }}
                title={`Click to filter rows by ${vec.name}`}
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const vr   = Math.floor(vs.rowOffset + (e.clientY - rect.top) / vs.cellH)
                  if (vr >= 0 && vr < displayRowOrder.length) {
                    const val = vec.values[displayRowOrder[vr]]
                    if (val != null) quickFilterRow(vec.name, String(val))
                  }
                }}
              >
                <RowAnnotationTrack
                  values={vec.values}
                  rowOrder={displayRowOrder}
                  rowOffset={vs.rowOffset}
                  cellH={vs.cellH}
                  width={trackW}
                  colors={effectiveColorMaps.get(vec.name)}
                  displayMode={trackMode}
                  textColor={theme.labelColor}
                />
                {hasFilter && (
                  <div className="absolute top-1 left-0 right-0 text-center text-[8px] pointer-events-none"
                    style={{ color: theme.filterColor }}>▼</div>
                )}
              </div>
            )
          })}

          {/* WebGL canvas */}
          <div ref={containerRef} className="flex-1 relative overflow-hidden"
            style={{ cursor: isDragging ? 'grabbing' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onWheel={onWheel}>
            <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
            {/* Search highlight overlays */}
            {highlightedRows.size > 0 && Array.from({ length: endRow - startRow }, (_, i) => {
              const vr = startRow + i
              const dr = displayRowOrder[vr]
              if (!highlightedRows.has(dr)) return null
              const y = (vr - vs.rowOffset) * vs.cellH
              const h = Math.max(vs.cellH, 2)
              return (
                <div key={vr} className="absolute left-0 right-0 pointer-events-none"
                  style={{
                    top: y, height: h,
                    outline: `2px solid ${theme.labelHighlight}`, outlineOffset: '-1px',
                    background: theme.highlightBg,
                    boxShadow: theme.highlightGlow,
                    zIndex: 10,
                  }}
                />
              )
            })}
          </div>
        </div>

        {/* ── Color legend ── */}
        <ColorScaleBar
          autoVmin={colorRange[0]} autoVmax={colorRange[1]}
          vminOverride={vminOverride} vmaxOverride={vmaxOverride}
          preset={colormapPreset}
          surface={theme.surface} isDark={darkMode}
          onPreset={setColormapPreset}
          onVmin={setVminOverride}
          onVmax={setVmaxOverride}
        />

        {/* ── Errors ── */}
        {annotError && (
          <div className="px-3 py-1 text-xs text-red-700 bg-red-50 border-t border-red-200 flex justify-between">
            <span>{annotError}</span>
            <button onClick={() => setAnnotError(null)} className="underline ml-2">dismiss</button>
          </div>
        )}
        {sessionError && (
          <div className="px-3 py-1 text-xs text-orange-700 bg-orange-50 border-t border-orange-200 flex justify-between">
            <span>Session: {sessionError}</span>
            <button onClick={() => setSessionError(null)} className="underline ml-2">dismiss</button>
          </div>
        )}
      </div>

      {/* ── Right comparison panel ── */}
      <div
        className="shrink-0 border-l border-[--color-border] transition-all"
        style={{
          width: compareOpen ? PANEL_W : 0,
          minWidth: compareOpen ? PANEL_W : 0,
          background: theme.surface,
          overflow: compareOpen ? 'auto' : 'hidden',
        }}
      >
        {compareOpen && (
          <>
            <GroupBuilder
              colAnnotVecs={colAnnotVecs}
              selectedField={annotField}
              onFieldChange={handleFieldChange}
              groupAssignments={groupAssignments}
              onAssign={assignGroup}
              groupACount={groupACols.length}
              groupBCount={groupBCols.length}
              test={compareTest}
              onTestChange={t => { setCompareTest(t); setCompareResults(null) }}
              correction={compareCorr}
              onCorrectionChange={c => { setCompareCorr(c); setCompareResults(null) }}
              running={compareRunning}
              progress={compareProgress}
              onRun={runComparison}
              onClose={() => setCompareOpen(false)}
              isDark={darkMode}
            />
            {compareResults && (
              <div className="border-t border-[--color-border]">
                <ResultsPanel
                  results={compareResults}
                  hasPValue={hasPValue}
                  onGeneClick={onGeneClick}
                  onAddAnnotations={onAddAnnotations}
                  isDark={darkMode}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Filter panel ── */}
      {/* ── Export modal ── */}
      {exportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setExportOpen(false) }}
        >
          <div className="rounded-lg shadow-2xl flex flex-col"
            style={{ background: theme.bg, border: `1px solid ${darkMode ? '#2a2a45' : '#e0e0e0'}`, width: 340, overflow: 'hidden' }}>
            {/* header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b text-xs font-semibold"
              style={{ background: theme.surface, borderColor: darkMode ? '#2a2a45' : '#e0e0e0', color: darkMode ? '#a0a8ff' : '#2563eb' }}>
              Export heatmap as PNG
              <button onClick={() => setExportOpen(false)} className="hover:opacity-70 font-normal text-base leading-none" style={{ color: darkMode ? '#6b7280' : '#6b7280' }}>×</button>
            </div>
            {/* body */}
            <div className="px-4 py-3 flex flex-col gap-3 text-xs font-mono" style={{ color: darkMode ? '#e2e8f0' : '#1a1a1a' }}>
              <div className="text-[10px]" style={{ color: darkMode ? '#6b7280' : '#6b7280' }}>
                Renders all <b style={{ color: darkMode ? '#e2e8f0' : '#1a1a1a' }}>{displayRowOrder.length} rows × {displayColOrder.length} cols</b> currently visible (with active filters and sort order), series: <b style={{ color: darkMode ? '#e2e8f0' : '#1a1a1a' }}>{dataset.seriesNames[activeSeries]}</b>.
              </div>
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0" style={{ color: darkMode ? '#9ca3af' : '#6b7280' }}>Width (px)</label>
                <input type="number" min={100} max={32000} step={100}
                  value={exportW}
                  onFocus={e => e.target.select()}
                  onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n > 0) setExportW(n) }}
                  className="flex-1 rounded px-2 py-0.5 text-xs font-mono"
                  style={{ background: darkMode ? '#0f0f22' : '#fff', color: darkMode ? '#e2e8f0' : '#1a1a1a', border: `1px solid ${darkMode ? '#2a2a45' : '#e0e0e0'}`, outline: 'none' }}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0" style={{ color: darkMode ? '#9ca3af' : '#6b7280' }}>Height (px)</label>
                <input type="number" min={100} max={32000} step={100}
                  value={exportH}
                  onFocus={e => e.target.select()}
                  onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n > 0) setExportH(n) }}
                  className="flex-1 rounded px-2 py-0.5 text-xs font-mono"
                  style={{ background: darkMode ? '#0f0f22' : '#fff', color: darkMode ? '#e2e8f0' : '#1a1a1a', border: `1px solid ${darkMode ? '#2a2a45' : '#e0e0e0'}`, outline: 'none' }}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0" style={{ color: darkMode ? '#9ca3af' : '#6b7280' }}>Background</label>
                <div className="flex gap-1">
                  {([['White', true], ['Dark', false]] as [string, boolean][]).map(([label, val]) => (
                    <button key={label} onClick={() => setExportLightBg(val)}
                      className="px-2 py-0.5 rounded text-xs border transition-colors"
                      style={exportLightBg === val
                        ? { background: darkMode ? '#2a2a6e' : '#dbeafe', color: darkMode ? '#a0a8ff' : '#1d4ed8', borderColor: darkMode ? '#4040a0' : '#93c5fd' }
                        : { background: 'transparent', color: darkMode ? '#6b7280' : '#6b7280', borderColor: darkMode ? '#2a2a45' : '#e0e0e0' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px]" style={{ color: darkMode ? '#4b5563' : '#9ca3af' }}>
                Output: {exportW} × {exportH} px · {((exportW * exportH * 4) / 1e6).toFixed(1)} MB uncompressed
              </div>
            </div>
            {/* footer */}
            <div className="px-4 py-2.5 border-t flex justify-end"
              style={{ background: theme.surface, borderColor: darkMode ? '#2a2a45' : '#e0e0e0' }}>
              <button
                onClick={exportHeatmapPng}
                disabled={exportLoading}
                className="px-3 py-1 rounded text-xs font-semibold border transition-colors disabled:opacity-50"
                style={{ background: darkMode ? '#2a2a6e' : '#dbeafe', color: darkMode ? '#a0a8ff' : '#1d4ed8', borderColor: darkMode ? '#4040a0' : '#93c5fd' }}
              >
                {exportLoading ? 'Rendering…' : '↓ Download PNG'}
              </button>
            </div>
          </div>
        </div>
      )}

      {filterPanelOpen && (
        <FilterPanel
          seriesNames={dataset.seriesNames}
          rowValueFilters={rowValueFilters}
          colValueFilters={colValueFilters}
          rowIdFilter={rowIdFilter}
          colIdFilter={colIdFilter}
          onRowValueFiltersChange={handleRowValueFiltersChange}
          onColValueFiltersChange={handleColValueFiltersChange}
          onRowIdFilterChange={handleRowIdFilterChange}
          onColIdFilterChange={handleColIdFilterChange}
          onClose={() => setFilterPanelOpen(false)}
          isDark={darkMode}
        />
      )}

      {/* Hidden file input for session loading */}
      <input
        ref={sessionFileRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) loadSession(file)
          e.target.value = ''
        }}
      />

      {/* ── Tooltip ── */}
      {tooltip && (
        <div className="fixed z-50 pointer-events-none rounded px-2 py-1.5 text-xs font-mono shadow-xl"
          style={{
            left: tooltip.clientX + 14, top: tooltip.clientY - 8,
            background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, maxWidth: 260,
          }}>
          <div className="font-semibold text-[--color-accent] truncate">{tooltip.gene}</div>
          <div className="truncate mb-1" style={{ color: theme.tooltipMuted }}>{tooltip.sample}</div>
          {dataset.seriesNames.map((name, i) => (
            <div key={i} className="flex justify-between gap-3 tabular-nums text-xs"
              style={{ color: i === activeSeries ? theme.tooltipValue : theme.tooltipMuted }}>
              <span>{name}</span>
              <span>{isNaN(tooltip.values[i]) ? '—' : tooltip.values[i].toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sidebar section ───────────────────────────────────────────────────────────

function SidebarSection({
  title, vecs, visible, onToggle, onSelectAll, onDeselectAll, onSort, onDrop, loading,
  filters, onToggleValue, onClearFilter, theme,
  trackDisplayModes, onToggleDisplayMode, colorMaps, onColorChange,
}: {
  title: string
  vecs: Vector[]
  visible: Set<string>
  onToggle: (name: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onSort: (name: string, dir: 'asc' | 'desc') => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  loading: boolean
  filters: Map<string, Set<string>>
  onToggleValue: (field: string, value: string) => void
  onClearFilter: (field: string) => void
  theme: Theme
  trackDisplayModes: Map<string, 'color' | 'text'>
  onToggleDisplayMode: (name: string) => void
  colorMaps: Map<string, Map<string, string>>
  onColorChange: (fieldName: string, category: string, color: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpanded = (name: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s })

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[--color-text-muted] uppercase tracking-wide text-[10px]">{title}</div>
        {vecs.length > 5 && (
          <div className="flex gap-2">
            <button onClick={onSelectAll}
              className="text-[9px] underline hover:opacity-70"
              style={{ color: theme.checkActive }}>all</button>
            <button onClick={onDeselectAll}
              className="text-[9px] underline hover:opacity-70 text-[--color-text-muted]">none</button>
          </div>
        )}
      </div>

      {vecs.length === 0 && (
        <div
          className="border border-dashed border-[--color-border] rounded p-2 text-center text-[--color-text-muted] text-[10px] cursor-default"
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          {loading ? 'Loading…' : 'Drop TSV here'}
        </div>
      )}

      {vecs.map(vec => {
        const isExpanded   = expanded.has(vec.name)
        const hasFilter    = filters.has(vec.name)
        const activeFilter = filters.get(vec.name)
        const vals         = uniqueValues(vec)
        const isString     = vec.dataType === 'string' && vals.length > 0
        const displayMode  = trackDisplayModes.get(vec.name) ?? 'color'

        return (
          <div key={vec.name}>
            <div className="flex items-center gap-1 py-0.5">
              {/* visibility checkbox */}
              <button
                onClick={() => onToggle(vec.name)}
                className="w-3 h-3 rounded-sm border flex-shrink-0"
                style={{
                  background:  visible.has(vec.name) ? theme.checkActive : 'transparent',
                  borderColor: theme.checkBorder,
                }}
              />
              {/* expand toggle for filter values (string fields only) */}
              {isString ? (
                <button
                  onClick={() => toggleExpanded(vec.name)}
                  className="text-[9px] text-[--color-text-muted] hover:text-[--color-text] w-3 text-center flex-shrink-0"
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
              ) : (
                <span className="w-3 flex-shrink-0" />
              )}
              <span className="flex-1 truncate text-[--color-text-muted]" title={vec.name}>
                {vec.name}
              </span>
              {hasFilter && (
                <span className="text-[10px]" style={{ color: theme.filterColor }}>●</span>
              )}
              {/* text / color display mode toggle */}
              <button
                onClick={() => onToggleDisplayMode(vec.name)}
                className="text-[9px] px-0.5 rounded flex-shrink-0"
                style={{
                  color:       displayMode === 'text' ? theme.checkActive : theme.textMuted,
                  border:      `1px solid ${displayMode === 'text' ? theme.checkBorder : 'transparent'}`,
                }}
                title={`Show as ${displayMode === 'text' ? 'color' : 'text'}`}
              >
                {displayMode === 'text' ? 'T' : 'C'}
              </button>
              <button onClick={() => onSort(vec.name, 'asc')}
                className="text-[--color-text-muted] hover:text-[--color-text] px-0.5">↑</button>
              <button onClick={() => onSort(vec.name, 'desc')}
                className="text-[--color-text-muted] hover:text-[--color-text] px-0.5">↓</button>
              {hasFilter && (
                <button onClick={() => onClearFilter(vec.name)}
                  className="hover:opacity-70 text-[10px]"
                  style={{ color: theme.filterColor }}
                  title="Clear filter">×</button>
              )}
            </div>

            {/* Expanded value list */}
            {isExpanded && isString && (
              <div className="ml-5 mb-1">
                <div className="flex gap-2 mb-0.5">
                  <button
                    onClick={() => onClearFilter(vec.name)}
                    className="text-[9px] text-[--color-text-muted] hover:text-[--color-text] underline"
                  >all</button>
                </div>
                <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto pr-1">
                  {vals.map(val => {
                    const included  = !activeFilter || activeFilter.has(val)
                    const catColor  = colorMaps.get(vec.name)?.get(val) ?? '#555555'
                    return (
                      <div key={val} className="flex items-center gap-1">
                        <button
                          onClick={() => onToggleValue(vec.name, val)}
                          className="w-3 h-3 rounded-sm border flex-shrink-0"
                          style={{
                            background:  included ? theme.checkActive : 'transparent',
                            borderColor: theme.checkBorder,
                          }}
                        />
                        {/* color swatch with picker — only in color mode */}
                        {displayMode === 'color' && (
                          <label
                            style={{
                              width: 12, height: 12, display: 'block', flexShrink: 0,
                              background: catColor,
                              border: '1px solid rgba(128,128,128,0.3)',
                              borderRadius: 2, cursor: 'pointer', position: 'relative',
                            }}
                            title={`Change color for "${val}"`}
                          >
                            <input
                              type="color"
                              value={catColor}
                              onChange={e => onColorChange(vec.name, val, e.target.value)}
                              style={{
                                opacity: 0, position: 'absolute', width: 0, height: 0,
                                top: 0, left: 0,
                              }}
                            />
                          </label>
                        )}
                        <span
                          className="truncate text-[10px] cursor-pointer"
                          style={{ color: included ? theme.valueActive : theme.valueInactive }}
                          onClick={() => onToggleValue(vec.name, val)}
                          title={val}
                        >{val}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {vecs.length > 0 && (
        <div
          className="border border-dashed border-[--color-border] rounded p-1 text-center text-[--color-text-muted] text-[10px] mt-1 cursor-default"
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          {loading ? 'Loading…' : '+ Drop TSV'}
        </div>
      )}
    </div>
  )
}

// ── Color scale bar ───────────────────────────────────────────────────────────

const PRESETS = Object.keys(COLORMAP_LABELS) as ColormapPreset[]

function ColorScaleBar({ autoVmin, autoVmax, vminOverride, vmaxOverride, preset, surface, isDark, onPreset, onVmin, onVmax }: {
  autoVmin: number; autoVmax: number
  vminOverride: number | null; vmaxOverride: number | null
  preset: ColormapPreset
  surface: string; isDark: boolean
  onPreset: (p: ColormapPreset) => void
  onVmin: (v: number | null) => void
  onVmax: (v: number | null) => void
}) {
  const muted  = isDark ? '#6b7280' : '#9ca3af'
  const text   = isDark ? '#e2e8f0' : '#1a1a1a'
  const border = isDark ? '#2a2a45' : '#e0e0e0'
  const inputStyle: React.CSSProperties = {
    background: isDark ? '#0f0f22' : '#fff', color: text,
    border: `1px solid ${border}`, outline: 'none',
    width: 68, textAlign: 'right' as const,
  }
  const effectiveVmin = vminOverride ?? autoVmin
  const effectiveVmax = vmaxOverride ?? autoVmax
  const overridden = vminOverride !== null || vmaxOverride !== null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-t flex-wrap text-xs font-mono"
      style={{ background: surface, borderColor: border, color: muted }}>

      {/* Colormap preset pills */}
      <div className="flex gap-1 shrink-0">
        {PRESETS.map(p => (
          <button key={p} onClick={() => onPreset(p)}
            className="px-1.5 py-0.5 rounded border text-[10px] transition-colors"
            style={p === preset
              ? { background: isDark ? '#2a2a6e' : '#dbeafe', color: isDark ? '#a0a8ff' : '#1d4ed8', borderColor: isDark ? '#4040a0' : '#93c5fd' }
              : { background: 'transparent', color: muted, borderColor: border }}>
            {COLORMAP_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="w-px h-4 shrink-0" style={{ background: border }} />

      {/* Min input */}
      <input type="number" step="any"
        value={effectiveVmin}
        onFocus={e => e.target.select()}
        onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) onVmin(n) }}
        className="rounded px-1.5 py-0.5 tabular-nums"
        style={inputStyle}
        title="Color scale minimum"
      />

      {/* Gradient bar */}
      <div className="h-3 rounded shrink-0" style={{ width: 120, background: COLORMAP_CSS[preset] }} />

      {/* Max input */}
      <input type="number" step="any"
        value={effectiveVmax}
        onFocus={e => e.target.select()}
        onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) onVmax(n) }}
        className="rounded px-1.5 py-0.5 tabular-nums"
        style={{ ...inputStyle, textAlign: 'left' }}
        title="Color scale maximum"
      />

      {/* Reset link */}
      {overridden && (
        <button onClick={() => { onVmin(null); onVmax(null) }}
          className="underline text-[10px] shrink-0 hover:opacity-70" style={{ color: muted }}>
          reset
        </button>
      )}

      <span className="ml-auto text-[10px] hidden lg:inline" style={{ color: isDark ? '#4b5563' : '#c0c0c0' }}>
        scroll · shift+scroll · ctrl+scroll zoom · drag to pan
      </span>
    </div>
  )
}
