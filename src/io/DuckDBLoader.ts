import * as duckdb from '@duckdb/duckdb-wasm'
import duckdbMvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import duckdbMvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import duckdbEhWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import duckdbEhWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import { DefaultDataset } from '../core/Dataset'
import type { Dataset } from '../core/Dataset'

// Singleton — initialised once, reused for all queries
let db: duckdb.AsyncDuckDB | null = null

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdbMvpWasm, mainWorker: duckdbMvpWorker },
  eh:  { mainModule: duckdbEhWasm,  mainWorker: duckdbEhWorker  },
}

export async function getDB(): Promise<duckdb.AsyncDuckDB> {
  if (db) return db
  const bundle = await duckdb.selectBundle(BUNDLES)
  const worker = await duckdb.createWorker(bundle.mainWorker!)
  const logger = new duckdb.VoidLogger()
  db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  return db
}

/**
 * Load a Parquet or Arrow IPC file into a Dataset.
 * DuckDB reads the file directly from a registered buffer — no full copy needed.
 */
export async function loadParquet(file: File): Promise<Dataset> {
  const instance = await getDB()
  const conn = await instance.connect()

  // Register the file so DuckDB can read it
  await instance.registerFileHandle(file.name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true)

  // Read schema first
  const schema = await conn.query(`DESCRIBE SELECT * FROM read_parquet('${file.name}') LIMIT 0`)
  const schemaRows = schema.toArray()

  const columns = schemaRows.map((r: { column_name: string; column_type: string }) => ({
    name: String(r.column_name),
    type: String(r.column_type),
  }))

  // First column is assumed to be the row identifier; rest are samples
  const idColName = columns[0].name
  const sampleCols = columns.slice(1)
  const nCols = sampleCols.length

  // Count rows
  const countResult = await conn.query(`SELECT count(*) as n FROM read_parquet('${file.name}')`)
  const nRows = Number(countResult.toArray()[0].n)

  const dataset = new DefaultDataset(nRows, nCols, 'score')

  const rowIdVec = dataset.rowMetadata.addVector('id', 'string')
  const colIdVec = dataset.colMetadata.addVector('id', 'string')
  sampleCols.forEach((col, i) => { colIdVec.values[i] = col.name })

  // Stream all rows
  const result = await conn.query(`SELECT * FROM read_parquet('${file.name}')`)
  const rows = result.toArray()

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    rowIdVec.values[r] = String(row[idColName])
    for (let c = 0; c < nCols; c++) {
      const val = row[sampleCols[c].name]
      dataset.setValue(r, c, val == null ? NaN : Number(val))
    }
  }

  await conn.close()
  return dataset
}

export async function loadArrow(file: File): Promise<Dataset> {
  // Arrow IPC files are also readable via DuckDB using read_parquet with arrow protocol
  // Reuse the same path — DuckDB auto-detects Arrow IPC vs Parquet
  return loadParquet(file)
}
