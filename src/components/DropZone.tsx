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
                {['TDM', 'TSV', 'CSV'].map(fmt => (
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

        {/* Format guide */}
        <div className="mt-5 rounded-xl border border-[--color-border] bg-[--color-surface] overflow-hidden">
          <div className="px-4 py-2 border-b border-[--color-border]">
            <span className="text-xs font-semibold text-[--color-text-muted] uppercase tracking-wide">Supported file formats</span>
          </div>
          <div className="divide-y divide-[--color-border]">
            {[
              {
                tag: 'TSV / TXT',
                ext: '.tsv  .txt',
                desc: 'Plain tab-separated table. The first row contains sample IDs (one per column) and the first column contains gene or probe IDs. This is the simplest format — you can export it directly from Excel or R (write.table) or Python (df.to_csv(..., sep="\\t")).',
                example: 'gene_id\tSample1\tSample2\tSample3\nGENE_A\t1.23\t−0.45\t0.80\nGENE_B\t−1.10\t2.34\t0.11',
              },
              {
                tag: 'CSV',
                ext: '.csv',
                desc: 'Comma-separated table, same layout as TSV. First row = sample IDs, first column = gene/probe IDs. Export from Excel as "CSV (comma delimited)" or use df.to_csv() in Python.',
                example: 'gene_id,Sample1,Sample2,Sample3\nGENE_A,1.23,−0.45,0.80\nGENE_B,−1.10,2.34,0.11',
              },
              {
                tag: 'TDM',
                ext: '.tdm',
                desc: 'Gitools Tab-Delimited Matrix — a long/melted format where each line represents one cell. Header: column, row, then one column per data series. Missing values are encoded as "−". Supports multiple data layers (e.g. expression + p-value) in a single file.',
                example: 'column\trow\texpression\tp-value\nSample1\tGENE_A\t1.23\t0.04\nSample1\tGENE_B\t−1.10\t0.12',
              },
            ].map(({ tag, ext, desc, example }) => (
              <div key={tag} className="px-4 py-3 flex gap-3">
                <div className="shrink-0 w-24 pt-0.5">
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[--color-bg] border border-[--color-border] text-[--color-accent]">{tag}</span>
                  <div className="text-[10px] text-[--color-text-muted] mt-0.5 font-mono">{ext}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[--color-text-muted] leading-relaxed">{desc}</p>
                  {example && (
                    <pre className="mt-1.5 text-[10px] rounded px-2 py-1 overflow-x-auto bg-[--color-bg] text-[--color-text-muted] border border-[--color-border]">{example}</pre>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-[--color-border] text-[10px] text-[--color-text-muted]">
            Annotation files (sample groups, gene names) can be added after loading — drag a TSV onto the Annotations sidebar.
          </div>
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
