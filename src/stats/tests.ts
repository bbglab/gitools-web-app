// Portions derived from Morpheus.js
// Copyright (c) 2017, Connectivity Map and LINCS at the Broad Institute
// BSD 3-Clause License — see LICENSE.morpheus in the project root

import { normalCDF, tTestPValue, normalQuantile, logHypergeomProb } from './math'
import type { TestName } from './types'

export interface TestResult {
  score: number
  pvalue: number
}

function mean(vals: number[]): number {
  if (vals.length === 0) return NaN
  let s = 0; for (const v of vals) s += v
  return s / vals.length
}

function variance(vals: number[], m: number): number {
  if (vals.length < 2) return NaN
  let s = 0; for (const v of vals) s += (v - m) ** 2
  return s / (vals.length - 1)
}

// Welch's t-test (two-sided) — ported from Morpheus bivariate_functions.js
export function welchTTest(a: number[], b: number[]): TestResult {
  const na = a.length, nb = b.length
  if (na < 2 || nb < 2) return { score: NaN, pvalue: NaN }
  const ma = mean(a), mb = mean(b)
  const va = variance(a, ma), vb = variance(b, mb)
  const se = Math.sqrt(va / na + vb / nb)
  if (se === 0) return { score: 0, pvalue: 1 }
  const t = (ma - mb) / se
  const df = (va / na + vb / nb) ** 2 /
             ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
  return { score: t, pvalue: tTestPValue(Math.abs(t), df) }
}

// Signal-to-noise ratio — ported from Morpheus bivariate_functions.js
export function signalToNoise(a: number[], b: number[]): TestResult {
  const ma = mean(a), mb = mean(b)
  const sa = Math.sqrt(variance(a, ma) ?? 0)
  const sb = Math.sqrt(variance(b, mb) ?? 0)
  const denom = sa + sb
  return { score: denom === 0 ? 0 : (ma - mb) / denom, pvalue: NaN }
}

// Signal-to-noise with adjusted (floored) SD — ported from Morpheus bivariate_functions.js
export function signalToNoiseAdjSD(a: number[], b: number[]): TestResult {
  const ma = mean(a), mb = mean(b)
  const sa = Math.sqrt(variance(a, ma) ?? 0)
  const sb = Math.sqrt(variance(b, mb) ?? 0)
  const floor = Math.max(0.2 * Math.abs(Math.max(Math.abs(ma), Math.abs(mb))), 0.1)
  const denom = Math.max(sa, floor) + Math.max(sb, floor)
  return { score: (ma - mb) / denom, pvalue: NaN }
}

// Fold change (log2 mean ratio) — ported from Morpheus bivariate_functions.js
export function foldChange(a: number[], b: number[]): TestResult {
  const ma = mean(a), mb = mean(b)
  if (mb === 0) return { score: NaN, pvalue: NaN }
  return { score: Math.log2(ma / mb), pvalue: NaN }
}

// Mean difference — ported from Morpheus bivariate_functions.js
export function meanDifference(a: number[], b: number[]): TestResult {
  return { score: mean(a) - mean(b), pvalue: NaN }
}

// Fisher exact test (binary data: value > 0 counts as success)
// Ported from Morpheus bivariate_functions.js
export function fisherExact(a: number[], b: number[]): TestResult {
  const na = a.length, nb = b.length
  if (na === 0 || nb === 0) return { score: NaN, pvalue: NaN }
  const ka = a.filter(v => v > 0).length
  const kb = b.filter(v => v > 0).length
  const K  = ka + kb          // total positives
  const N  = na + nb          // grand total
  const logP0 = logHypergeomProb(ka, na, K, N)

  let pval = 0
  const kMin = Math.max(0, na - (N - K))
  const kMax = Math.min(na, K)
  for (let k = kMin; k <= kMax; k++) {
    const logPk = logHypergeomProb(k, na, K, N)
    if (logPk <= logP0 + 1e-10) pval += Math.exp(logPk)
  }
  const score = ka / na - kb / nb  // difference in proportions
  return { score, pvalue: Math.min(1, pval) }
}

// Mann-Whitney U / Wilcoxon rank-sum (asymptotic normal approx with tie correction)
export function mannWhitneyU(a: number[], b: number[]): TestResult {
  const na = a.length, nb = b.length
  if (na === 0 || nb === 0) return { score: NaN, pvalue: NaN }

  const combined = [
    ...a.map(v => ({ v, grp: 0 })),
    ...b.map(v => ({ v, grp: 1 })),
  ].sort((x, y) => x.v - y.v)

  const n = combined.length
  const ranks = new Float64Array(n)
  let i = 0
  while (i < n) {
    let j = i
    while (j < n && combined[j].v === combined[i].v) j++
    const avg = (i + j - 1) / 2 + 1
    for (let k = i; k < j; k++) ranks[k] = avg
    i = j
  }

  let Ra = 0
  for (let k = 0; k < n; k++) if (combined[k].grp === 0) Ra += ranks[k]

  const Ua    = Ra - na * (na + 1) / 2
  const meanU = na * nb / 2

  // Tie correction
  let tieSum = 0
  i = 0
  while (i < n) {
    let j = i
    while (j < n && combined[j].v === combined[i].v) j++
    const t = j - i
    if (t > 1) tieSum += t ** 3 - t
    i = j
  }
  const varU = (na * nb / 12) * (n + 1 - tieSum / (n * (n - 1)))
  if (varU <= 0) return { score: 0, pvalue: 1 }

  const Z = (Ua - meanU) / Math.sqrt(varU)
  return { score: Z, pvalue: 2 * (1 - normalCDF(Math.abs(Z))) }
}

// Z-score / Stouffer's method for combining p-values — from Gitools
// Group A and B values are expected to be p-values in (0, 1)
export function zScoreTest(a: number[], b: number[]): TestResult {
  const toZ = (p: number) => normalQuantile(1 - p)
  const aZ = a.filter(v => v > 0 && v < 1 && !isNaN(v)).map(toZ)
  const bZ = b.filter(v => v > 0 && v < 1 && !isNaN(v)).map(toZ)
  if (aZ.length === 0) return { score: NaN, pvalue: NaN }
  const Za = aZ.reduce((s, z) => s + z, 0) / Math.sqrt(aZ.length)
  const Zb = bZ.length > 0 ? bZ.reduce((s, z) => s + z, 0) / Math.sqrt(bZ.length) : 0
  const score = Za - Zb
  return { score, pvalue: 2 * (1 - normalCDF(Math.abs(score))) }
}

// Binomial test (normal approx) — from Gitools
// Tests if proportion of positives in group A deviates from background rate
export function binomialTest(a: number[], b: number[]): TestResult {
  const na = a.length
  if (na === 0) return { score: NaN, pvalue: NaN }
  const ka  = a.filter(v => v > 0).length
  const kb  = b.filter(v => v > 0).length
  const p0  = (ka + kb) / (na + b.length)
  if (p0 <= 0 || p0 >= 1) return { score: 0, pvalue: 1 }
  const Z = (ka - na * p0) / Math.sqrt(na * p0 * (1 - p0))
  return { score: Z, pvalue: 2 * (1 - normalCDF(Math.abs(Z))) }
}

export function runTest(name: TestName, a: number[], b: number[]): TestResult {
  switch (name) {
    case 'ttest':        return welchTTest(a, b)
    case 'snr':          return signalToNoise(a, b)
    case 'snr_adj':      return signalToNoiseAdjSD(a, b)
    case 'fold_change':  return foldChange(a, b)
    case 'mean_diff':    return meanDifference(a, b)
    case 'fisher_exact': return fisherExact(a, b)
    case 'mann_whitney': return mannWhitneyU(a, b)
    case 'zscore_test':  return zScoreTest(a, b)
    case 'binomial':     return binomialTest(a, b)
  }
}
