import type { Dataset } from '../core/Dataset'
import type { VectorValue } from '../core/MetadataModel'
import type { ValueFilterRule, IdFilterConfig } from '../components/viewer/FilterPanel'

// ── Session format ────────────────────────────────────────────────────────────

export interface SessionAnnotation {
  axis: 'row' | 'col'
  name: string
  dataType: 'string' | 'number'
  values: VectorValue[]
}

export interface SerializedIdFilter {
  ids: string[]
  mode: 'include' | 'exclude'
}

export interface SessionViewState {
  darkMode: boolean
  colormapPreset: string
  vminOverride: number | null
  vmaxOverride: number | null
  activeSeries: number
  rowOrder: number[]
  colOrder: number[]
  visColTracks: string[]
  visRowTracks: string[]
  trackDisplayModes: [string, 'color' | 'text'][]
  customColors: [string, [string, string][]][]
  rowFilters: [string, string[]][]
  colFilters: [string, string[]][]
  rowValueFilters: ValueFilterRule[]
  colValueFilters: ValueFilterRule[]
  rowIdFilter: SerializedIdFilter | null
  colIdFilter: SerializedIdFilter | null
}

export interface GitoolsSession {
  version: 1
  timestamp: string
  dataInfo: {
    rowCount: number
    colCount: number
    seriesNames: string[]
  }
  annotations: SessionAnnotation[]
  viewState: SessionViewState
}

// ── Build ─────────────────────────────────────────────────────────────────────

export function buildSession(
  dataset: Dataset,
  viewState: SessionViewState,
): GitoolsSession {
  const annotations: SessionAnnotation[] = []

  for (const vec of dataset.rowMetadata.vectors) {
    if (vec.name === 'id') continue
    annotations.push({ axis: 'row', name: vec.name, dataType: vec.dataType, values: [...vec.values] })
  }
  for (const vec of dataset.colMetadata.vectors) {
    if (vec.name === 'id') continue
    annotations.push({ axis: 'col', name: vec.name, dataType: vec.dataType, values: [...vec.values] })
  }

  return {
    version: 1,
    timestamp: new Date().toISOString(),
    dataInfo: {
      rowCount: dataset.rowCount,
      colCount: dataset.colCount,
      seriesNames: [...dataset.seriesNames],
    },
    annotations,
    viewState,
  }
}

export function serializeIdFilter(f: IdFilterConfig | null): SerializedIdFilter | null {
  if (!f) return null
  return { ids: [...f.ids], mode: f.mode }
}

export function deserializeIdFilter(f: SerializedIdFilter | null): IdFilterConfig | null {
  if (!f) return null
  return { ids: new Set(f.ids), mode: f.mode }
}

// ── IO ────────────────────────────────────────────────────────────────────────

export function downloadSession(session: GitoolsSession, filename = 'session.gitools.json'): void {
  const blob = new Blob([JSON.stringify(session)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function parseSessionFile(file: File): Promise<GitoolsSession> {
  const text = await file.text()
  const obj  = JSON.parse(text)
  if (obj?.version !== 1) {
    throw new Error(`Unknown session version: ${obj?.version ?? 'missing'}`)
  }
  return obj as GitoolsSession
}

// ── URL hash state (view preferences only — not data or sort order) ───────────

export interface UrlViewState {
  dark?: boolean
  cmap?: string
  series?: number
}

export function encodeHashState(state: UrlViewState): string {
  const parts: string[] = []
  if (state.dark) parts.push('dark=1')
  if (state.cmap && state.cmap !== 'bwr') parts.push(`cmap=${encodeURIComponent(state.cmap)}`)
  if (state.series !== undefined && state.series !== 0) parts.push(`s=${state.series}`)
  return parts.length > 0 ? '#' + parts.join('&') : window.location.pathname + window.location.search
}

export function parseHashState(): UrlViewState {
  const hash = window.location.hash.slice(1)
  if (!hash) return {}
  const params = new URLSearchParams(hash)
  const result: UrlViewState = {}
  if (params.has('dark'))  result.dark   = params.get('dark') === '1'
  if (params.has('cmap'))  result.cmap   = params.get('cmap') ?? undefined
  if (params.has('s')) {
    const n = parseInt(params.get('s') ?? '', 10)
    if (!isNaN(n)) result.series = n
  }
  return result
}
