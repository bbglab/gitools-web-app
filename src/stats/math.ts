// Numerical math utilities for statistical tests

// Error function approximation (Abramowitz & Stegun 7.1.26, max error ~1.2e-7)
export function erf(x: number): number {
  const a1 =  0.254829592
  const a2 = -0.284496736
  const a3 =  1.421413741
  const a4 = -1.453152027
  const a5 =  1.061405429
  const p  =  0.3275911
  const sign = x >= 0 ? 1 : -1
  x = Math.abs(x)
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x)
  return sign * y
}

export function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2))
}

// Normal quantile (probit) — Beasley-Springer-Moshier rational approximation
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (p === 0.5) return 0
  const a = [
    -3.969683028665376e+01,  2.209460984245205e+02,
    -2.759285104469687e+02,  1.383577518672690e+02,
    -3.066479806614716e+01,  2.506628277459239e+00,
  ]
  const b = [
    -5.447609879822406e+01,  1.615858368580409e+02,
    -1.556989798598866e+02,  6.680131188771972e+01,
    -1.328068155288572e+01,
  ]
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
     4.374664141464968e+00,  2.938163982698783e+00,
  ]
  const d = [
    7.784695709041462e-03,  3.224671290700398e-01,
    2.445134137142996e+00,  3.754408661907416e+00,
  ]
  const pLow  = 0.02425
  const pHigh = 1 - pLow
  let q: number
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
  } else if (p <= pHigh) {
    q = p - 0.5
    const r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
  }
}

// Log gamma — Lanczos approximation
function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x)
  x -= 1
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  let a = p[0]
  const t = x + 7.5
  for (let i = 1; i < 9; i++) a += p[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

// Regularized incomplete beta I_x(a, b) — Lentz continued fraction
function betaCF(x: number, a: number, b: number): number {
  const MAXIT = 300
  const EPS   = 3e-10
  const FPMIN = 1e-300
  const qab = a + b, qap = a + 1, qam = a - 1
  let c = 1, d = 1 - qab * x / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d; h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b)
  if (x < (a + 1) / (a + b + 2)) {
    return Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a * betaCF(x, a, b)
  } else {
    return 1 - Math.exp(b * Math.log(1 - x) + a * Math.log(x) - lbeta) / b * betaCF(1 - x, b, a)
  }
}

// Two-tailed p-value for Welch t-test given |t| and df
export function tTestPValue(absT: number, df: number): number {
  if (df <= 0 || isNaN(absT) || isNaN(df)) return NaN
  const x = df / (df + absT * absT)
  return incompleteBeta(x, df / 2, 0.5)
}

// Log factorial — Stirling for large n
const _factCache = [0, 0]  // log(0!) = 0, log(1!) = 0
export function logFact(n: number): number {
  if (n < 0) return NaN
  while (_factCache.length <= n) _factCache.push(_factCache[_factCache.length - 1] + Math.log(_factCache.length))
  return _factCache[n]
}

// Log hypergeometric probability P(X = k) for 2x2 table
// N total, K total successes, n sample size, k successes in sample
export function logHypergeomProb(k: number, n: number, K: number, N: number): number {
  return logFact(K) - logFact(k) - logFact(K - k)
       + logFact(N - K) - logFact(n - k) - logFact(N - K - n + k)
       - logFact(N) + logFact(n) + logFact(N - n)
}
