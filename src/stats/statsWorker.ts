// Portions derived from Morpheus.js
// Copyright (c) 2017, Connectivity Map and LINCS at the Broad Institute
// BSD 3-Clause License — see LICENSE.morpheus in the project root

import { runTest } from './tests'
import { bhFDR, bonferroni } from './correction'
import type { WorkerRequest, WorkerResponse } from './types'

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const { values, rowCount, colCount, rowNames, groupACols, groupBCols, test, correction } = e.data

    const scores:  number[] = new Array(rowCount)
    const pvalues: number[] = new Array(rowCount)
    const meansA:  number[] = new Array(rowCount)
    const meansB:  number[] = new Array(rowCount)

    for (let row = 0; row < rowCount; row++) {
      const a: number[] = []
      const b: number[] = []
      const base = row * colCount
      for (const col of groupACols) {
        const v = values[base + col]
        if (!isNaN(v)) a.push(v)
      }
      for (const col of groupBCols) {
        const v = values[base + col]
        if (!isNaN(v)) b.push(v)
      }

      meansA[row] = a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : NaN
      meansB[row] = b.length > 0 ? b.reduce((s, v) => s + v, 0) / b.length : NaN

      const res   = runTest(test, a, b)
      scores[row] = res.score
      pvalues[row] = res.pvalue

      if (row % 1000 === 0) {
        const msg: WorkerResponse = { type: 'progress', pct: row / rowCount }
        self.postMessage(msg)
      }
    }

    let fdr: number[]
    if (correction === 'BH')         fdr = bhFDR(pvalues)
    else if (correction === 'Bonferroni') fdr = bonferroni(pvalues)
    else                              fdr = [...pvalues]

    const results = Array.from({ length: rowCount }, (_, i) => ({
      rowIndex: i,
      name:  rowNames[i] ?? `Row ${i}`,
      score: scores[i],
      pvalue: pvalues[i],
      fdr:   fdr[i],
      meanA: meansA[i],
      meanB: meansB[i],
    }))

    const msg: WorkerResponse = { type: 'done', results }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerResponse = { type: 'error', message: String(err) }
    self.postMessage(msg)
  }
}
