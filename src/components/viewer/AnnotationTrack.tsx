import { useRef, useEffect, useMemo } from 'react'
import type { VectorValue } from '../../core/MetadataModel'

// ── Color palettes ────────────────────────────────────────────────────────────

const CAT_PALETTE = [
  '#4f8ef7','#ef4444','#22c55e','#f59e0b','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#6366f1','#eab308','#10b981','#f43f5e','#8b5cf6',
  '#0ea5e9','#d97706','#65a30d','#db2777','#0d9488',
]

export function buildCategoryColors(values: VectorValue[]): Map<string, string> {
  const cats = new Set<string>()
  values.forEach(v => { if (v != null && v !== '') cats.add(String(v)) })
  const sorted = [...cats].sort()
  const map = new Map<string, string>()
  sorted.forEach((cat, i) => map.set(cat, CAT_PALETTE[i % CAT_PALETTE.length]))
  return map
}

// ── Column annotation track (horizontal strip) ───────────────────────────────

interface ColTrackProps {
  values: VectorValue[]           // one per data column
  colOrder: number[]              // colOrder[viewCol] = dataCol
  colOffset: number               // fractional col offset from viewport
  cellW: number                   // CSS px per column
  height: number                  // track height px
  colors?: Map<string, string>    // categorical color map (auto-built if absent)
  vmin?: number                   // for continuous tracks
  vmax?: number
}

export function ColAnnotationTrack({
  values, colOrder, colOffset, cellW, height, colors, vmin, vmax,
}: ColTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const catColors = useMemo(() => {
    if (colors) return colors
    const allVals = colOrder.map(i => values[i])
    const isNumeric = allVals.every(v => v == null || typeof v === 'number')
    if (isNumeric) return null
    return buildCategoryColors(values)
  }, [values, colOrder, colors])

  const numericRange = useMemo(() => {
    if (vmin !== undefined && vmax !== undefined) return [vmin, vmax]
    const nums = values.filter(v => typeof v === 'number') as number[]
    if (nums.length === 0) return [0, 1]
    const mn = Math.min(...nums), mx = Math.max(...nums)
    return [mn, mx === mn ? mn + 1 : mx]
  }, [values, vmin, vmax])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.offsetWidth
    canvas.width  = Math.round(cssW * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const nCols = colOrder.length
    for (let vc = 0; vc < nCols; vc++) {
      const x = (vc - colOffset) * cellW
      if (x + cellW < 0 || x > cssW) continue
      const dc  = colOrder[vc]
      const val = values[dc]
      if (val == null || val === '') continue

      let color = '#555'
      if (catColors) {
        color = catColors.get(String(val)) ?? '#555'
      } else {
        const [mn, mx] = numericRange
        const t = Math.max(0, Math.min(1, (Number(val) - mn) / (mx - mn)))
        const r = Math.round(33 + (214 - 33) * t)
        const g = Math.round(102 + (96 - 102) * t)
        const b = Math.round(172 + (77 - 172) * t)
        color = `rgb(${r},${g},${b})`
      }
      ctx.fillStyle = color
      ctx.fillRect(Math.round(x * dpr), 0, Math.max(1, Math.round(cellW * dpr)), canvas.height)
    }
  })

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height }}
    />
  )
}

// ── Row annotation track (vertical strip) ────────────────────────────────────

interface RowTrackProps {
  values: VectorValue[]
  rowOrder: number[]
  rowOffset: number
  cellH: number
  width: number
  colors?: Map<string, string>
  vmin?: number
  vmax?: number
}

export function RowAnnotationTrack({
  values, rowOrder, rowOffset, cellH, width, colors, vmin, vmax,
}: RowTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const catColors = useMemo(() => {
    if (colors) return colors
    const isNumeric = rowOrder.every(i => values[i] == null || typeof values[i] === 'number')
    if (isNumeric) return null
    return buildCategoryColors(values)
  }, [values, rowOrder, colors])

  const numericRange = useMemo(() => {
    if (vmin !== undefined && vmax !== undefined) return [vmin, vmax]
    const nums = values.filter(v => typeof v === 'number') as number[]
    if (nums.length === 0) return [0, 1]
    const mn = Math.min(...nums), mx = Math.max(...nums)
    return [mn, mx === mn ? mn + 1 : mx]
  }, [values, vmin, vmax])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const cssH = canvas.offsetHeight
    canvas.width  = Math.round(width * dpr)
    canvas.height = Math.round(cssH * dpr)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const nRows = rowOrder.length
    for (let vr = 0; vr < nRows; vr++) {
      const y = (vr - rowOffset) * cellH
      if (y + cellH < 0 || y > cssH) continue
      const dr  = rowOrder[vr]
      const val = values[dr]
      if (val == null || val === '') continue

      let color = '#555'
      if (catColors) {
        color = catColors.get(String(val)) ?? '#555'
      } else {
        const [mn, mx] = numericRange
        const t = Math.max(0, Math.min(1, (Number(val) - mn) / (mx - mn)))
        const r = Math.round(33 + (214 - 33) * t)
        const g = Math.round(102 + (96 - 102) * t)
        const b = Math.round(172 + (77 - 172) * t)
        color = `rgb(${r},${g},${b})`
      }
      ctx.fillStyle = color
      ctx.fillRect(0, Math.round(y * dpr), canvas.width, Math.max(1, Math.round(cellH * dpr)))
    }
  })

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width, height: '100%' }}
    />
  )
}
