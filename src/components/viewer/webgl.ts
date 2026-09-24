import type { Dataset } from '../../core/Dataset'

// ── Shaders ───────────────────────────────────────────────────────────────────

export const VERT_SRC = `#version 300 es
void main() {
  // Fullscreen quad via gl_VertexID — no VBO needed
  vec2 pos = vec2(
    float((gl_VertexID & 1) * 2 - 1),
    float((gl_VertexID >> 1) * 2 - 1)
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}`

export const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D u_data;      // R32F, tiled layout (see u_tilingK)
uniform sampler2D u_colormap;  // RGB, 256×1
uniform vec2  u_dataSize;      // (nCols, nRows) — virtual data dimensions
uniform vec2  u_texSize;       // (texW, texH) — actual texture dimensions
uniform float u_tilingK;       // tiling factor: K data rows per texture row
uniform vec2  u_canvasSize;    // physical pixels (×dpr)
uniform vec2  u_cellSize;      // physical pixels per cell
uniform vec2  u_offset;        // (colOffset, rowOffset) in data units
uniform float u_vmin;
uniform float u_vmax;
uniform vec4  u_bgColor;

out vec4 fragColor;

void main() {
  // gl_FragCoord.y = 0 at bottom; flip so row 0 is at top
  vec2 pos = vec2(gl_FragCoord.x, u_canvasSize.y - gl_FragCoord.y);

  float col = u_offset.x + pos.x / u_cellSize.x;
  float row = u_offset.y + pos.y / u_cellSize.y;

  if (col < 0.0 || col >= u_dataSize.x || row < 0.0 || row >= u_dataSize.y) {
    fragColor = u_bgColor;
    return;
  }

  // Tiled texture lookup:
  //   K data rows are packed side-by-side in each texture row.
  //   For K=1 this degenerates to the natural (col, row) lookup.
  float vRow = floor(row);
  float vCol = floor(col);
  float texX = mod(vRow, u_tilingK) * u_dataSize.x + vCol;
  float texY = floor(vRow / u_tilingK);
  vec2 uv = (vec2(texX, texY) + 0.5) / u_texSize;
  float value = texture(u_data, uv).r;

  // Absent cells are stored as MISSING_SENTINEL (-1e30) to avoid the NaN→0
  // driver bug on macOS/Metal R32F textures.
  if (value < -9e29) {
    fragColor = vec4(0.22, 0.22, 0.28, 1.0);
    return;
  }

  float t = clamp((value - u_vmin) / (u_vmax - u_vmin), 0.0, 1.0);
  fragColor = texture(u_colormap, vec2(t, 0.5));
}`

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DataTextureResult {
  texture: WebGLTexture
  texW: number
  texH: number
  tilingK: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error:\n${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

export function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
  const prog = gl.createProgram()!
  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Program link error:\n${gl.getProgramInfoLog(prog)}`)
  }
  gl.deleteShader(vert)
  gl.deleteShader(frag)
  return prog
}

// Sentinel for "no data" cells — avoids the NaN→0 driver bug in R32F textures.
// Must stay in sync with the `value < -9e29` check in the fragment shader.
const MISSING_SENTINEL = -1e30

/**
 * Upload a data series to a WebGL R32F texture, tiling the rows if the
 * matrix height would exceed MAX_TEXTURE_SIZE.
 *
 * Tiling layout (K = tilingFactor):
 *   K consecutive data rows are packed side-by-side in each texture row.
 *   texW = nCols * K,  texH = ceil(nRows / K)
 *
 * Shader coordinate math:
 *   texX = (vRow % K) * nCols + vCol
 *   texY = floor(vRow / K)
 */
export function uploadDataTexture(
  gl: WebGL2RenderingContext,
  dataset: Dataset,
  series = 0,
  rowOrder?: number[],
  colOrder?: number[],
): DataTextureResult {
  const src      = dataset.getSeriesArray(series)
  const srcStride = dataset.colCount          // stride in the source flat array
  // Use the filtered counts for texture layout so the tiling tile width equals
  // u_dataSize.x — mismatching these caused wrong texture lookups when K > 1.
  const nRows    = rowOrder ? rowOrder.length : dataset.rowCount
  const nCols    = colOrder ? colOrder.length : dataset.colCount
  const maxSize  = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number

  // K = how many data rows fit side-by-side to keep texH ≤ maxSize
  const K    = Math.max(1, Math.ceil(nRows / maxSize))
  const texW = nCols * K
  const texH = Math.ceil(nRows / K)

  if (texW > maxSize) {
    throw new Error(
      `Matrix too large for this GPU: ${nRows}×${nCols} rows×cols requires ` +
      `texture width ${texW} > MAX_TEXTURE_SIZE ${maxSize}`
    )
  }

  // Build tiled array; pre-fill with sentinel so padding cells are "absent"
  const data = new Float32Array(texW * texH).fill(MISSING_SENTINEL)
  for (let r = 0; r < nRows; r++) {
    const dataR    = rowOrder ? rowOrder[r] : r
    const texRow   = Math.floor(r / K)
    const tileSlot = r % K
    const srcBase  = dataR * srcStride
    const dstBase  = texRow * texW + tileSlot * nCols
    for (let c = 0; c < nCols; c++) {
      const dataC = colOrder ? colOrder[c] : c
      const v = src[srcBase + dataC]
      data[dstBase + c] = isNaN(v) ? MISSING_SENTINEL : v
    }
  }

  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, texW, texH, 0, gl.RED, gl.FLOAT, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return { texture: tex, texW, texH, tilingK: K }
}

// Blue → White → Red diverging colormap (suitable for centered expression data)
export function makeColormapData(): Uint8Array {
  const n = 256
  const out = new Uint8Array(n * 3)
  const blue  = [33,  102, 172]
  const white = [247, 247, 247]
  const red   = [214, 96,  77]
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const [a, b, s] = t <= 0.5
      ? [blue,  white, t * 2]
      : [white, red,   (t - 0.5) * 2]
    out[i * 3]     = Math.round(a[0] + (b[0] - a[0]) * s)
    out[i * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * s)
    out[i * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * s)
  }
  return out
}

export function uploadColormapTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, makeColormapData())
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

// Symmetric 2nd–98th percentile range, good for median-centered data
export function computeColorRange(dataset: Dataset, series = 0): [number, number] {
  const arr = dataset.getSeriesArray(series)
  const vals: number[] = []
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (!isNaN(v) && isFinite(v)) vals.push(v)
  }
  if (vals.length === 0) return [-1, 1]
  vals.sort((a, b) => a - b)
  const p2  = vals[Math.max(0, Math.floor(vals.length * 0.02))]
  const p98 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.98))]
  const abs = Math.max(Math.abs(p2), Math.abs(p98), 0.01)
  return [-abs, abs]
}
