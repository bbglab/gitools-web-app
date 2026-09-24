// Portions derived from Morpheus.js
// Copyright (c) 2017, Connectivity Map and LINCS at the Broad Institute
// BSD 3-Clause License — see LICENSE.morpheus in the project root

// Benjamini-Hochberg FDR correction — ported from Morpheus FDR_BH
export function bhFDR(pvalues: number[]): number[] {
  const n   = pvalues.length
  const fdr = new Array<number>(n).fill(NaN)

  // Only rank rows that have a valid p-value; NaN rows stay NaN.
  // Sort NaN values explicitly to the end so they don't corrupt the carry.
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => {
      const pa = pvalues[a], pb = pvalues[b]
      if (isNaN(pa) && isNaN(pb)) return 0
      if (isNaN(pa)) return 1
      if (isNaN(pb)) return -1
      return pa - pb
    })

  // Count how many valid (non-NaN) p-values there are
  let m = 0
  while (m < n && !isNaN(pvalues[order[m]])) m++

  // BH step-down over the m valid rows only
  let carry = 1
  for (let i = m - 1; i >= 0; i--) {
    const idx = order[i]
    carry = Math.min(carry, (pvalues[idx] * m) / (i + 1))
    fdr[idx] = Math.min(carry, 1)
  }
  return fdr
}

// Bonferroni correction
export function bonferroni(pvalues: number[]): number[] {
  const n = pvalues.length
  return pvalues.map(p => (isNaN(p) ? NaN : Math.min(1, p * n)))
}
