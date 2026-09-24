import { useRef, useEffect, useCallback } from 'react'
import type { RowResult } from '../../stats/types'

interface Props {
  results: RowResult[]
  onGeneClick: (rowIndex: number) => void
  hasPValue: boolean
  isDark: boolean
}

const W = 340
const H = 220
const PAD = { top: 14, right: 14, bottom: 36, left: 44 }

function safeLog10(v: number): number {
  if (!isFinite(v) || isNaN(v) || v <= 0) return 0
  return -Math.log10(v)
}

export function VolcanoPlot({ results, onGeneClick, hasPValue, isDark }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const pointsRef  = useRef<{ x: number; y: number; r: RowResult }[]>([])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr  = window.devicePixelRatio || 1
    canvas.width  = W * dpr
    canvas.height = H * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = isDark ? '#0a0a12' : '#ffffff'
    ctx.fillRect(0, 0, W, H)

    const pW = W - PAD.left - PAD.right
    const pH = H - PAD.top  - PAD.bottom

    let xMin = Infinity, xMax = -Infinity, yMax = 0
    const ys: number[] = new Array(results.length)
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (isFinite(r.score)) {
        if (r.score < xMin) xMin = r.score
        if (r.score > xMax) xMax = r.score
      }
      const y = hasPValue ? safeLog10(r.fdr) : results.length - i
      ys[i] = y
      if (isFinite(y) && y > yMax) yMax = y
    }

    if (!isFinite(xMin)) return
    if (yMax === 0) yMax = 1

    const yMin   = 0
    const xRange = xMax - xMin || 1
    const yRange = yMax - yMin || 1

    const toCanvasX = (v: number) => PAD.left + ((v - xMin) / xRange) * pW
    const toCanvasY = (v: number) => PAD.top  + pH - ((v - yMin) / yRange) * pH

    // Grid baseline
    ctx.strokeStyle = isDark ? '#1f1f3a' : '#e5e7eb'
    ctx.lineWidth   = 0.5
    ctx.beginPath()
    ctx.moveTo(PAD.left, toCanvasY(0))
    ctx.lineTo(PAD.left + pW, toCanvasY(0))
    ctx.stroke()

    if (hasPValue) {
      const sigY = toCanvasY(1.301)
      ctx.strokeStyle = isDark ? '#3b3b6a' : '#d1d5db'
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(PAD.left, sigY)
      ctx.lineTo(PAD.left + pW, sigY)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Points
    pointsRef.current = []
    const SIG_FDR = 0.05

    for (let i = 0; i < results.length; i++) {
      const r  = results[i]
      const cx = toCanvasX(r.score)
      const cy = hasPValue ? toCanvasY(safeLog10(r.fdr)) : toCanvasY(yMax - i)

      if (!isFinite(cx) || !isFinite(cy)) continue

      const significant = hasPValue && r.fdr <= SIG_FDR
      let color: string
      if (!hasPValue)        color = '#6366f1'
      else if (!significant) color = isDark ? '#374151' : '#d1d5db'
      else if (r.score > 0)  color = '#3b82f6'
      else                   color = '#ef4444'

      ctx.fillStyle  = color
      ctx.globalAlpha = significant || !hasPValue ? 0.9 : 0.4
      ctx.beginPath()
      ctx.arc(cx, cy, significant ? 2.5 : 1.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1

      pointsRef.current.push({ x: cx, y: cy, r })
    }

    // Axes
    ctx.strokeStyle = isDark ? '#374151' : '#d1d5db'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(PAD.left, PAD.top)
    ctx.lineTo(PAD.left, PAD.top + pH)
    ctx.lineTo(PAD.left + pW, PAD.top + pH)
    ctx.stroke()

    // Y-axis ticks + labels
    ctx.fillStyle = isDark ? '#6b7280' : '#9ca3af'
    ctx.font        = '9px monospace'
    ctx.textAlign   = 'right'
    const nYTicks = 4
    for (let t = 0; t <= nYTicks; t++) {
      const val = yMin + (t / nYTicks) * yRange
      const cy2  = toCanvasY(val)
      ctx.beginPath()
      ctx.moveTo(PAD.left - 3, cy2); ctx.lineTo(PAD.left, cy2); ctx.stroke()
      ctx.fillText(val.toFixed(1), PAD.left - 5, cy2 + 3)
    }

    // X-axis ticks + labels
    ctx.textAlign = 'center'
    const nXTicks = 5
    for (let t = 0; t <= nXTicks; t++) {
      const val = xMin + (t / nXTicks) * xRange
      const cx2  = toCanvasX(val)
      ctx.beginPath()
      ctx.moveTo(cx2, PAD.top + pH); ctx.lineTo(cx2, PAD.top + pH + 3); ctx.stroke()
      ctx.fillText(val.toFixed(1), cx2, PAD.top + pH + 13)
    }

    // Axis labels
    ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280'
    ctx.font       = '10px monospace'
    ctx.textAlign  = 'center'
    ctx.fillText('Score', PAD.left + pW / 2, H - 2)
    ctx.save()
    ctx.translate(10, PAD.top + pH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(hasPValue ? '−log₁₀(FDR)' : 'Rank', 0, 0)
    ctx.restore()
  }, [results, hasPValue, isDark])

  useEffect(() => { draw() }, [draw])

  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let best: { d: number; r: RowResult } | null = null
    for (const { x, y, r } of pointsRef.current) {
      const d = Math.hypot(x - mx, y - my)
      if (!best || d < best.d) best = { d, r }
    }
    if (best && best.d < 12) onGeneClick(best.r.rowIndex)
  }, [onGeneClick])

  const downloadPNG = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = 'volcano_plot.png'
    a.click()
  }, [])

  const pngBtnStyle: React.CSSProperties = isDark
    ? { background: '#1e1e3a', color: '#9ca3af', border: '1px solid #374151' }
    : { background: '#f5f5f5', color: '#6b7280', border: '1px solid #e0e0e0' }

  return (
    <div className="shrink-0 relative">
      <canvas
        ref={canvasRef}
        style={{ width: W, height: H, cursor: 'crosshair', display: 'block' }}
        onClick={onClick}
        title="Click a point to jump to that gene in the heatmap"
      />
      <button
        onClick={downloadPNG}
        title="Download volcano plot as PNG"
        className="absolute top-1 right-1 text-[10px] font-mono px-1.5 py-0.5 rounded opacity-40 hover:opacity-100 transition-opacity"
        style={pngBtnStyle}
      >
        ↓ PNG
      </button>
    </div>
  )
}
