import { useRef, useEffect, useState, useCallback, useMemo, DragEvent } from 'react'
import type { Dataset } from '../../core/Dataset'
import type { Vector, VectorValue } from '../../core/MetadataModel'
import {
  createProgram, uploadDataTexture, uploadColormapTexture,
  computeColorRange,
} from './webgl'
import type { DataTextureResult } from './webgl'
import { ColAnnotationTrack, RowAnnotationTrack, buildCategoryColors } from './AnnotationTrack'
import { loadAnnotationTsv } from '../../io/AnnotationReader'
import { GroupBuilder, TEST_OPTIONS } from '../comparison/GroupBuilder'
import { ResultsPanel } from '../comparison/ResultsPanel'
import type { TestName, RowResult, WorkerRequest, WorkerResponse } from '../../stats/types'

const ROW_LABEL_W  = 140
const COL_LABEL_H  = 90
const TRACK_W      = 12
const TRACK_H      = 12
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

export function HeatmapViewer({ dataset }: { dataset: Dataset }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)

  const glRef      = useRef<WebGL2RenderingContext | null>(null)
  const progRef    = useRef<WebGLProgram | null>(null)
  const dataTexRef = useRef<DataTextureResult | null>(null)
  const cmapTexRef = useRef<WebGLTexture | null>(null)
  const rafRef     = useRef(0)

  const [darkMode, setDarkMode] = useState(false)
  const theme = darkMode ? DARK_THEME : LIGHT_THEME

  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [viewState, setViewState]   = useState<ViewState>({
    rowOffset: 0, colOffset: 0, cellW: 60, cellH: DEFAULT_CELL,
  })
  const [activeSeries, setActiveSeries] = useState(0)

  // Base sort orders — always contain ALL indices; filtering never mutates these
  const [rowOrder, setRowOrder] = useState<number[]>(() => identity(dataset.rowCount))
  const [colOrder, setColOrder] = useState<number[]>(() => identity(dataset.colCount))

  // Filters — fieldName → Set of allowed values (absent = all shown)
  const [rowFilters, setRowFilters] = useState<Map<string, Set<string>>>(new Map())
  const [colFilters, setColFilters] = useState<Map<string, Set<string>>>(new Map())

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
  const displayRowOrder = useMemo(() => {
    if (rowFilters.size === 0) return rowOrder
    return rowOrder.filter(dr => {
      for (const [field, allowed] of rowFilters) {
        const vec = dataset.rowMetadata.getVector(field)
        if (!vec) continue
        const val = vec.values[dr]
        if (val == null || !allowed.has(String(val))) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowOrder, rowFilters, dataset, annotVersion])

  const displayColOrder = useMemo(() => {
    if (colFilters.size === 0) return colOrder
    return colOrder.filter(dc => {
      for (const [field, allowed] of colFilters) {
        const vec = dataset.colMetadata.getVector(field)
        if (!vec) continue
        const val = vec.values[dc]
        if (val == null || !allowed.has(String(val))) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colOrder, colFilters, dataset, annotVersion])

  const colorRange = useMemo(
    () => computeColorRange(dataset, activeSeries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, activeSeries],
  )

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
      gl.uniform1f(gl.getUniformLocation(prog, 'u_vmin'),       colorRange[0])
      gl.uniform1f(gl.getUniformLocation(prog, 'u_vmax'),       colorRange[1])
      const [br, bg, bb, ba] = theme.clearColor
      gl.uniform4f(gl.getUniformLocation(prog, 'u_bgColor'),    br, bg, bb, ba)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    })
  }, [canvasSize, viewState, colorRange, dataset, displayRowOrder, displayColOrder, darkMode])

  // ── Sort (operates on full order, filter is applied on top) ──────────────────
  const [lastColSort, setLastColSort] = useState<{ dc: number; dir: 'asc' | 'desc' } | null>(null)
  const [lastRowSort, setLastRowSort] = useState<{ dr: number; dir: 'asc' | 'desc' } | null>(null)

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
    setTexVersion(v => v + 1)
    setViewState(vs => ({ ...vs, rowOffset: 0, colOffset: 0 }))
  }, [])

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
  const rowAnnotWidth = rowAnnotShown.length * TRACK_W

  const catColorMaps = useMemo(() => {
    const m = new Map<string, Map<string, string>>()
    ;[...colAnnotVecs, ...rowAnnotVecs].forEach(v => {
      if (v.dataType === 'string') m.set(v.name, buildCategoryColors(v.values))
    })
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, annotVersion])

  const hasPValue  = TEST_OPTIONS.find(t => t.value === compareTest)?.hasPValue ?? true
  const anyFilters = rowFilters.size > 0 || colFilters.size > 0

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
            className="px-2 py-0.5 rounded text-xs font-mono bg-[--color-bg] text-[--color-text] outline-none w-36"
            style={{ border: `1px solid ${searchBorderColor}` }}
          />
          <button
            onClick={() => setCompareOpen(o => !o)}
            className="text-xs px-2 py-0.5 rounded border transition-colors"
            style={compareOpen
              ? { background: theme.cmpActive.background, color: theme.cmpActive.color, borderColor: theme.cmpActive.borderColor }
              : { background: theme.cmpIdle.background,   color: theme.cmpIdle.color,   borderColor: theme.cmpIdle.borderColor }}
          >
            ⚖ Compare Groups
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
          <div className="flex items-center gap-2 px-3 py-0.5 shrink-0 text-[10px] font-mono border-b border-[--color-border]"
            style={{ background: theme.surface2 }}>
            <span style={{ color: theme.filterColor }}>Filters active:</span>
            {[...colFilters.entries()].map(([field, vals]) => (
              <span key={`c:${field}`} className="flex items-center gap-1"
                style={{ color: theme.filterColor }}>
                {field} ({vals.size})
                <button onClick={() => clearColFilter(field)} className="hover:opacity-70">×</button>
              </span>
            ))}
            {[...rowFilters.entries()].map(([field, vals]) => (
              <span key={`r:${field}`} className="flex items-center gap-1"
                style={{ color: theme.filterColor }}>
                {field} ({vals.size})
                <button onClick={() => clearRowFilter(field)} className="hover:opacity-70">×</button>
              </span>
            ))}
            <span className="text-[--color-text-muted] ml-1">
              — {nRows} rows, {nCols} cols shown
            </span>
            <button onClick={clearAllFilters}
              className="ml-auto underline text-[--color-text-muted]">
              Clear all
            </button>
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
              const hasFilter = colFilters.has(vec.name)
              return (
                <div key={vec.name}
                  className="relative overflow-hidden"
                  style={{ height: TRACK_H, cursor: 'pointer' }}
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
                    height={TRACK_H}
                    colors={catColorMaps.get(vec.name)}
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
              const vc      = startCol + i
              const dc      = displayColOrder[vc]
              const cx      = (vc - vs.colOffset) * vs.cellW + vs.cellW / 2
              const label   = (colIdVec?.values[dc] as string | null) ?? `S${dc}`
              const isActive = lastColSort?.dc === dc
              const arrow   = isActive ? (lastColSort.dir === 'desc' ? ' ▼' : ' ▲') : ''
              return (
                <div key={vc}
                  className="absolute text-xs font-mono cursor-pointer select-none hover:opacity-80"
                  style={{
                    left: cx, bottom: 6,
                    transform: 'rotate(-55deg)', transformOrigin: 'left bottom',
                    whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden',
                    color: isActive ? theme.labelHighlight : theme.textMuted,
                    fontWeight: isActive ? 'bold' : 'normal',
                  }}
                  onClick={() => sortRowsByCol(dc)}
                  title={`Sort genes by ${label}`}
                >
                  {label}{arrow}
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
              const vr      = startRow + i
              const dr      = displayRowOrder[vr]
              const cy      = (vr - vs.rowOffset) * vs.cellH + vs.cellH / 2
              const label   = (rowIdVec?.values[dr] as string | null) ?? `R${dr}`
              const isMatch  = highlightedRows.has(dr)
              const isActive = lastRowSort?.dr === dr
              const arrow    = isActive ? (lastRowSort.dir === 'desc' ? '▼ ' : '▲ ') : ''
              return (
                <div key={vr}
                  className="absolute right-2 font-mono truncate cursor-pointer select-none hover:opacity-80"
                  style={{
                    top: cy, maxWidth: ROW_LABEL_W - 10, transform: 'translateY(-50%)',
                    lineHeight: 1, fontSize: Math.min(12, vs.cellH * 0.75),
                    color:      isMatch || isActive ? theme.labelHighlight : theme.labelColor,
                    fontWeight: isMatch || isActive ? 'bold' : 'normal',
                  }}
                  onClick={() => sortColsByRow(dr)}
                  title={`Sort samples by ${label}`}
                >
                  {arrow}{label}
                </div>
              )
            })}
          </div>

          {/* Row annotation tracks */}
          {rowAnnotShown.map(vec => {
            const hasFilter = rowFilters.has(vec.name)
            return (
              <div key={vec.name}
                className="relative shrink-0 overflow-hidden"
                style={{ width: TRACK_W, cursor: 'pointer' }}
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
                  width={TRACK_W}
                  colors={catColorMaps.get(vec.name)}
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
        <ColorLegend vmin={colorRange[0]} vmax={colorRange[1]} surface={theme.surface} />

        {/* ── Errors ── */}
        {annotError && (
          <div className="px-3 py-1 text-xs text-red-700 bg-red-50 border-t border-red-200 flex justify-between">
            <span>{annotError}</span>
            <button onClick={() => setAnnotError(null)} className="underline ml-2">dismiss</button>
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
        const isExpanded  = expanded.has(vec.name)
        const hasFilter   = filters.has(vec.name)
        const activeFilter = filters.get(vec.name)
        const vals        = uniqueValues(vec)
        const isString    = vec.dataType === 'string' && vals.length > 0

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

            {/* Expanded value checkboxes */}
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
                    const included = !activeFilter || activeFilter.has(val)
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

// ── Color legend ──────────────────────────────────────────────────────────────

function ColorLegend({ vmin, vmax, surface }: { vmin: number; vmax: number; surface: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 shrink-0 border-t border-[--color-border]"
      style={{ background: surface }}>
      <span className="text-xs font-mono text-[--color-text-muted] tabular-nums w-12 text-right">{vmin.toFixed(2)}</span>
      <div className="h-2.5 rounded flex-1 max-w-40"
        style={{ background: 'linear-gradient(to right, rgb(33,102,172), rgb(247,247,247), rgb(214,96,77))' }} />
      <span className="text-xs font-mono text-[--color-text-muted] tabular-nums w-12">{vmax.toFixed(2)}</span>
      <span className="text-xs text-[--color-text-muted] ml-2">
        scroll rows · shift+scroll cols · ctrl+scroll zoom · drag to pan
      </span>
    </div>
  )
}
