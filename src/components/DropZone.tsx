import { useState, useRef, useCallback } from 'react'
import type { DragEvent, ChangeEvent } from 'react'
import type { Dataset } from '../core/Dataset'
import { detectFormat } from '../io/fileDetect'
import { parseGct } from '../io/GctReader'
import { parseCsv } from '../io/CsvReader'
import { loadParquet, loadArrow } from '../io/DuckDBLoader'
import { parseTdm } from '../io/TdmReader'

interface DropZoneProps {
  onDatasetLoaded: (dataset: Dataset, filename: string) => void
}

type LoadState = 'idle' | 'loading' | 'error'

export function DropZone({ onDatasetLoaded }: DropZoneProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [progress, setProgress] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setLoadState('loading')
    setProgress('Detecting format…')
    setErrorMsg('')

    try {
      const format = await detectFormat(file)
      let dataset: Dataset

      if (format === 'tdm') {
        setProgress('Scanning TDM…')
        dataset = await parseTdm(file, p => {
          if (p.phase === 1) {
            setProgress(`Scanning TDM… ${p.linesRead.toLocaleString()} lines`)
          } else {
            const pct = p.totalLines > 0 ? Math.round(100 * p.linesRead / p.totalLines) : '?'
            setProgress(`Loading TDM… ${pct}%`)
          }
        })
      } else if (format === 'gct') {
        setProgress('Parsing GCT…')
        dataset = await parseGct(file, p => {
          setProgress(`Parsing GCT… ${p.rowsRead.toLocaleString()} / ${p.totalRows.toLocaleString()} rows`)
        })
      } else if (format === 'tsv' || format === 'csv') {
        setProgress('Parsing…')
        dataset = await parseCsv(file, { separator: format === 'csv' ? ',' : '\t' }, p => {
          setProgress(`Parsing… ${p.rowsRead.toLocaleString()} rows read`)
        })
      } else if (format === 'parquet') {
        setProgress('Loading Parquet…')
        dataset = await loadParquet(file)
      } else if (format === 'arrow') {
        setProgress('Loading Arrow…')
        dataset = await loadArrow(file)
      } else {
        throw new Error(`Unsupported file format. Supported: GCT, TSV, CSV, Parquet, Arrow.`)
      }

      setLoadState('idle')
      onDatasetLoaded(dataset, file.name)
    } catch (err) {
      setLoadState('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }, [onDatasetLoaded])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(true)
  }

  const onDragLeave = () => setDragging(false)

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="w-full max-w-lg">
        {/* Drop area */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => loadState === 'idle' && inputRef.current?.click()}
          className={[
            'relative flex flex-col items-center justify-center gap-4',
            'border-2 border-dashed rounded-xl p-12 cursor-pointer',
            'transition-all duration-150',
            dragging
              ? 'border-[--color-accent] bg-[#2563eb10]'
              : 'border-[--color-border] hover:border-[--color-accent] bg-[--color-surface]',
            loadState === 'loading' ? 'pointer-events-none opacity-80' : '',
          ].join(' ')}
        >
          {loadState === 'loading' ? (
            <>
              <Spinner />
              <p className="text-sm text-[--color-text-muted] font-mono">{progress}</p>
            </>
          ) : (
            <>
              <MatrixIcon />
              <div className="text-center">
                <p className="font-semibold text-[--color-text]">Drop your matrix file here</p>
                <p className="text-sm text-[--color-text-muted] mt-1">or click to browse</p>
              </div>
              <div className="flex gap-2 flex-wrap justify-center">
                {['TDM', 'GCT v1.2', 'GCT v1.3', 'TSV', 'CSV', 'Parquet', 'Arrow'].map(fmt => (
                  <span
                    key={fmt}
                    className="px-2 py-0.5 rounded text-xs font-mono bg-[--color-bg] border border-[--color-border] text-[--color-text-muted]"
                  >
                    {fmt}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Error */}
        {loadState === 'error' && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <strong>Error:</strong> {errorMsg}
            <button
              onClick={() => { setLoadState('idle'); setErrorMsg('') }}
              className="ml-3 underline hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".tdm,.gct,.tsv,.txt,.csv,.parquet,.arrow,.ipc,.feather"
          onChange={onInputChange}
        />
      </div>
    </div>
  )
}

function MatrixIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-[--color-text-muted]">
      <rect x="4" y="4" width="10" height="10" rx="1" fill="#4f8ef730" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="19" y="4" width="10" height="10" rx="1" fill="#ef444430" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="34" y="4" width="10" height="10" rx="1" fill="#4f8ef730" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="4" y="19" width="10" height="10" rx="1" fill="#22c55e30" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="19" y="19" width="10" height="10" rx="1" fill="#4f8ef730" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="34" y="19" width="10" height="10" rx="1" fill="#ef444430" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="4" y="34" width="10" height="10" rx="1" fill="#4f8ef730" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="19" y="34" width="10" height="10" rx="1" fill="#22c55e30" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="34" y="34" width="10" height="10" rx="1" fill="#4f8ef730" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin text-[--color-accent]" width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}
