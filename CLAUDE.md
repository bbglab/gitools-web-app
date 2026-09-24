# gitools-web

A modern, browser-based genomics matrix explorer. Brings Gitools' full statistical suite to the browser, with a task-driven UX that guides users through load → annotate → explore → compare without needing to know the tool's vocabulary first.

Runs entirely in the browser as a static web app — no server required.

---

## Goals

- Load matrices up to ~300 columns × 20,000 rows efficiently
- Multi-series (multidimensional) cells: multiple named values per gene/sample cell
- Row and column annotations with visual tracks
- Full group comparison statistics (Gitools parity + Morpheus methods)
- Modern, task-driven UX — guided, not menu-driven
- Deploy as a static site (GitHub Pages, Netlify, etc.)

---

## Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript + React + Vite | Type safety, fast HMR, static deploy |
| Data format | Parquet (storage) → Arrow IPC (browser) | Columnar binary; 5–10× smaller than TSV |
| In-browser query | DuckDB-WASM | SQL for filtering, grouping, stat inputs |
| Heatmap render | WebGL (custom GLSL shader) | Only viable at 6M cells; 60fps pan/zoom |
| Annotation tracks | Canvas 2D | Fast 1D strips alongside the heatmap |
| Labels / lists | TanStack Virtual | Virtual scrolling for 20k gene labels |
| Statistics | jStat + custom implementations | Full Gitools + Morpheus stat suite |
| Background compute | Web Workers | Stats, clustering — never block the UI |
| UI chrome | Tailwind CSS + shadcn/ui | Consistent, accessible components |
| Desktop shell | **Tauri v2** | Wraps the web app; ships as .exe / .dmg / .AppImage (~10 MB) |

### Distribution

Two targets, same codebase:

| Target | How to run | Who it's for |
|---|---|---|
| Browser (static) | Deploy to GitHub Pages / Netlify | Anyone with a URL |
| Desktop (Tauri) | Double-click .exe / .dmg / .AppImage | Local install, works fully offline |

Tauri wraps the Vite build in a native webview. The web app code is identical in both targets. `src-tauri/` contains only the thin Rust launcher (~10 lines) and the app metadata (icon, window size, CSP).

### Data pipeline

```
User drops file
     │
     ├── .parquet / .arrow  →  DuckDB-WASM loads directly
     ├── .gct / .tsv        →  Streaming line parser → DuckDB-WASM
     └── .cls               →  Annotation parser → MetadataModel
           │
           ▼
     DuckDB-WASM (in-browser SQL)
           │  viewport slice (Float32Array)
           ▼
     WebGL heatmap renderer    ← viewport culling; only visible cells drawn
           │
     Canvas 2D annotation strips (row/column metadata)
```

---

## UX: four-step task flow

The UI is organised around what users actually want to do, not around tool capabilities.

```
① LOAD          ②  ANNOTATE        ③  EXPLORE          ④  COMPARE
────────────    ────────────────    ────────────────    ──────────────────
Drag & drop     Drag annotation     Heatmap center.     "Compare Groups"
any file.       TSV/CLS. Headers    Zoom, pan, sort,    button. Click
Auto-detect     matched auto-       search, tooltip,    annotation values
format. Show    matically. Color    switch series,      to paint A vs B.
dimension       strips appear       cluster rows/       Pick test. Results
preview before  immediately.        cols.               panel inline.
opening.
```

### Key UX principles

1. **Drag-and-drop everything** — matrix, annotations, gene sets. No file-type dialogs.
2. **Annotation sidebar** — left panel lists all metadata fields. Toggle, recolor, sort with one click; no menus.
3. **Visual group builder** — click annotation category values directly on the column strip to assign Group A / B. No dialog to fill in.
4. **Cell tooltip** — hover shows gene, sample, all series values, group assignment if active.
5. **Results panel** — comparison output is a right-side panel (volcano plot + ranked table), not annotation tracks only. Click a gene in the table to highlight its row in the heatmap.
6. **Progressive disclosure** — default view is heatmap + zoom + search. Clustering, multi-series, advanced color controls are behind an "Advanced" toggle.
7. **Shareable URL** — view state (file, annotations, active comparison, zoom) encoded in the URL.

---

## Build phases

### Phase 1 — Foundation & file loading

**Goal:** open a matrix file and see a colored heatmap.

- Vite + React + TypeScript project scaffold
- Core data model (TypeScript):
  - `Dataset` — rows × cols × N named series (Float32Array per series)
  - `MetadataModel` — named `Vector` arrays attached to rows or columns
  - `Positions` — binary-search viewport culling (ported from Morpheus, BSD-3)
- File loading:
  - DuckDB-WASM initialisation and Parquet/Arrow IPC reader
  - Streaming GCT v1.2 / v1.3 parser (ported from Morpheus `BufferedReader`, BSD-3)
  - TSV parser with auto-detection of id columns
  - CLS annotation file parser
- Drag-and-drop landing zone with format auto-detection
- Load preview: dimensions, series names, first 5 rows
- Basic layout shell: toolbar + left sidebar + main canvas area

**Deliverable:** drag in a GCT or TSV, see a heatmap.

---

### Phase 2 — Heatmap engine

**Goal:** fast, interactive heatmap for 6M cells.

- WebGL renderer:
  - GLSL fragment shader: maps Float32 value → RGBA via color scale texture
  - Renders only the visible tile (viewport culling via `Positions`)
  - Supports NaN (rendered as grey)
- Pan (pointer drag) and zoom (wheel) at 60fps
- Color scale:
  - Presets: Red-White-Blue (diverging), Viridis, Greys
  - Custom min/max/midpoint controls
  - Per-series color scales
- Series switcher: dropdown to pick which series drives color; optional second series drives cell-size dots (like Morpheus conditional rendering)
- Gene and sample label rendering with TanStack Virtual
- Hover tooltip: gene name, sample name, all series values for that cell

**Deliverable:** smooth pan/zoom on a 20k-row matrix with tooltips.

---

### Phase 3 — Annotations

**Goal:** load metadata and use it to navigate the heatmap.

- Annotation sidebar (left panel):
  - Lists all row and column metadata fields
  - Toggle visibility, change color mapping, reorder tracks
- Column/row annotation tracks rendered in Canvas 2D alongside the WebGL heatmap:
  - Categorical → color swatch (auto-palette or user-defined)
  - Continuous → gradient bar
  - Text labels at sufficient zoom
- Sort rows or columns by any annotation field (ascending / descending)
- Filter: click an annotation category → hide all other columns/rows
- Search: text box to find genes (rows) by name
- Annotation color legend panel

**Deliverable:** load a CLS/TSV annotation file, see colored strips, sort/filter by them.

---

### Phase 4 — Group comparison

**Goal:** define two groups visually, run a statistical test, see ranked results.

#### Group builder UI

1. "Compare Groups" button opens a right panel
2. User picks an annotation field from a dropdown
3. Clicks annotation category values to assign them to Group A (blue) or Group B (red)
4. Columns in the heatmap immediately color-coded; group sizes shown
5. User picks a statistical test from a plain-language dropdown
6. "Run" → Web Worker executes; progress indicator shown
7. Results panel appears: volcano plot + ranked gene table
8. Top-N genes highlighted in heatmap; new annotation track added automatically

#### Statistical tests (Web Worker, all per-row/gene)

Tests run per row (gene), comparing the set of values in Group A vs Group B.

| Test | Type | Source |
|---|---|---|
| **T-test** (Welch's, two-sided) | Parametric | Port from Morpheus `bivariate_functions.js` (BSD-3) |
| **Signal-to-noise ratio** | Score | Port from Morpheus (BSD-3) |
| **Signal-to-noise (adjusted SD)** | Score | Port from Morpheus (BSD-3) |
| **Fold change** (log2 mean ratio) | Score | Port from Morpheus (BSD-3) |
| **Mean difference** | Score | Port from Morpheus (BSD-3) |
| **Fisher exact** (binary data) | Non-parametric | Port from Morpheus (BSD-3) |
| **Mann-Whitney U** (Wilcoxon rank-sum) | Non-parametric | New — `jStat.mannwhitney` |
| **Z-score test** (on precomputed p-values) | Score | New — from Gitools |
| **Binomial test** | Non-parametric | New — `jStat.binomial` |

#### P-values and correction

- **Asymptotic p-values**: t-distribution CDF (jStat) for T-test; normal approximation for Mann-Whitney U
- **Permutation p-values**: configurable N permutations; ported from Morpheus `PermutationPValues` (BSD-3); 2-sided smoothed; runs in Web Worker
- **Multiple testing correction**: Benjamini-Hochberg FDR (ported from Morpheus `FDR_BH`, BSD-3); Bonferroni

#### Results

- Volcano plot: x = score/fold-change, y = −log10(FDR); click point to highlight row
- Ranked gene table: gene | score | p-value | FDR | group A mean | group B mean
- Export results as TSV
- Results written back as row annotation vectors (permanent, visible in heatmap)

**Deliverable:** click two groups on an annotation strip, pick Mann-Whitney U, see a volcano plot and ranked gene list.

---

### Phase 5 — Clustering, export, sharing

**Goal:** cluster rows/columns, export, share views.

- Hierarchical clustering (Web Worker):
  - Distance metrics: Euclidean, Pearson, Spearman, Kendall — ported from Morpheus (BSD-3)
  - Linkage: complete, average, single
  - Dendrogram rendered in Canvas 2D alongside heatmap
- K-means clustering (Web Worker) — ported from Morpheus (BSD-3)
- t-SNE (Web Worker) — ported from Morpheus (BSD-3)
- Data transformations: log2, log2(x+1), z-score, robust z-score, quantile normalisation — ported from Morpheus `adjust_tool.js` (BSD-3)
- Export:
  - Heatmap as PNG
  - Current view as GCT
  - Comparison results as TSV
- URL state encoding: file source (if remote URL), active annotations, active comparison, zoom/pan offset, active series
- Session save / restore (JSON download + reload)

**Deliverable:** cluster a matrix, export the view, share a URL.

---

## Data model (TypeScript)

```typescript
// Multiple named numeric layers per cell — same as Gitools dimensions
interface Dataset {
  rowCount: number
  colCount: number
  seriesNames: string[]           // e.g. ['expression', 'p-value', 'fold_change']
  seriesArrays: Float32Array[]    // one flat row-major array per series
  rowMetadata: MetadataModel
  colMetadata: MetadataModel
  getValue(row: number, col: number, series?: number): number
  setValue(row: number, col: number, value: number, series?: number): void
}

interface MetadataModel {
  vectors: Vector[]               // one Vector per annotation field
}

interface Vector {
  name: string
  array: (string | number)[]      // one value per row or column
  dataType: 'string' | 'float' | 'int'
  properties: Map<string, unknown> // color mapping, display mode, etc.
}
```

---

## Statistical methods — Gitools parity checklist

| Method | Gitools | Morpheus | morpheus-gitools |
|---|---|---|---|
| T-test (Welch's) | Yes | Yes | Phase 4 |
| Signal-to-noise | Yes | Yes | Phase 4 |
| Fold change | Yes | Yes | Phase 4 |
| Mean difference | Yes | Yes | Phase 4 |
| Fisher exact | Yes | Yes | Phase 4 |
| **Mann-Whitney U** | Yes | **No** | Phase 4 |
| **Z-score test** | Yes | **No** | Phase 4 |
| **Binomial test** | Yes | **No** | Phase 4 |
| Permutation p-values | Yes | Yes | Phase 4 |
| BH FDR correction | Yes | Yes | Phase 4 |
| Bonferroni | Yes | Partial | Phase 4 |
| Z-score normalisation | Yes | Yes | Phase 5 |
| Robust z-score | Yes | Yes | Phase 5 |
| Quantile normalisation | Yes | Yes | Phase 5 |

---

## File format support

| Format | Read | Write | Notes |
|---|---|---|---|
| Parquet / Arrow IPC | Phase 1 | Phase 5 | Primary; use for large matrices |
| GCT v1.2 | Phase 1 | Phase 5 | Broad Institute format, single series |
| GCT v1.3 | Phase 1 | Phase 5 | Multi-series support |
| Tab-delimited TSV | Phase 1 | Phase 5 | Auto-detected |
| CLS | Phase 1 | — | Sample class / annotation |
| Python converter script | Phase 1 | — | TSV/GCT → Parquet (pandas + pyarrow) |

---

## Morpheus.js — algorithm reference (BSD 3-Clause)

[Morpheus.js](https://github.com/cmap/morpheus.js) (Broad Institute) — **BSD 3-Clause**.
Code may be freely copied, modified, and redistributed with attribution.

### What we port from Morpheus (all require attribution header)

| Component | Morpheus source | Our use |
|---|---|---|
| Viewport culling | `src/matrix/positions.js` | TypeScript port, Phase 2 |
| Annotation model | `src/matrix/metadata_model.js` | TypeScript port, Phase 1 |
| T-test, S2N, fold change, Fisher exact | `src/matrix/bivariate_functions.js` | TypeScript port, Phase 4 |
| Permutation engine | `src/algorithm/permutation_p_values.js` | TypeScript port, Phase 4 |
| FDR BH correction | `src/matrix/univariate_functions.js` | TypeScript port, Phase 4 |
| Hierarchical clustering | `src/algorithm/hcluster.js` | TypeScript port, Phase 5 |
| K-means | `src/tools/kmeans_tool.js` | TypeScript port, Phase 5 |
| t-SNE | `src/tools/tsne_tool.js` | TypeScript port, Phase 5 |
| GCT / streaming text parser | `src/io/buffered_reader.js` | TypeScript port, Phase 1 |
| Data transforms (z-score, log2, qnorm) | `src/tools/adjust_tool.js` | TypeScript port, Phase 5 |

### Attribution rule

Every file that copies or substantially derives from Morpheus must include:

```typescript
// Portions derived from Morpheus.js
// Copyright (c) 2017, Connectivity Map and LINCS at the Broad Institute
// BSD 3-Clause License — see LICENSE.morpheus in the project root
```

Full license text kept at `LICENSE.morpheus`. Do **not** use "Broad Institute",
"Connectivity Map", or "LINCS" as endorsements without written permission.

---

## Key design constraints (non-negotiable)

- **No DOM rendering for the heatmap** — WebGL only; Canvas 2D only for 1D annotation strips
- **Viewport culling is mandatory** — never iterate all rows/columns; only the visible slice
- **Stats and clustering always run in Web Workers** — never block the main thread
- **No full TSV loading into memory** — stream through DuckDB-WASM; keep TSV parser as fallback only
- **Multi-series support from day one** — data model must support N layers per cell; retrofitting is painful
