export type TestName =
  | 'ttest'
  | 'snr'
  | 'snr_adj'
  | 'fold_change'
  | 'mean_diff'
  | 'fisher_exact'
  | 'mann_whitney'
  | 'zscore_test'
  | 'binomial'

export interface RowResult {
  rowIndex: number
  name: string
  score: number
  pvalue: number
  fdr: number
  meanA: number
  meanB: number
}

export interface WorkerRequest {
  type: 'run'
  values: Float32Array
  rowCount: number
  colCount: number
  rowNames: string[]
  groupACols: number[]
  groupBCols: number[]
  test: TestName
  correction: 'BH' | 'Bonferroni' | 'none'
}

export type WorkerResponse =
  | { type: 'progress'; pct: number }
  | { type: 'done'; results: RowResult[] }
  | { type: 'error'; message: string }
