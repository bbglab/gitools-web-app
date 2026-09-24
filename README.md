# gitools-web

A modern, browser-based genomics matrix explorer. Brings Gitools' full statistical suite to the browser, with a task-driven UX that guides users through load → annotate → explore → compare.

Runs entirely in the browser as a static web app — no server required.

---

## Features

- Load matrices up to ~300 columns × 20,000 rows (GCT v1.2/v1.3, TSV, Parquet, Arrow IPC)
- Multi-series (multidimensional) cells: multiple named values per gene/sample cell
- Fast WebGL heatmap with pan and zoom at 60 fps
- Row and column annotation tracks from TSV or CLS files
- Group comparison statistics with volcano plot and ranked results
- Search, filter, and sort by annotation fields or by sum across selected columns/rows

## Statistical tests

| Test | Source |
|---|---|
| T-test (Welch's, two-sided) | Ported from Morpheus.js (BSD-3) |
| Signal-to-noise ratio | Ported from Morpheus.js (BSD-3) |
| Fold change (log₂) | Ported from Morpheus.js (BSD-3) |
| Mean difference | Ported from Morpheus.js (BSD-3) |
| Fisher exact | Ported from Morpheus.js (BSD-3) |
| Mann-Whitney U (Wilcoxon rank-sum) | Original implementation |
| Z-score / Stouffer's method | Original implementation |
| Binomial test | Original implementation |

P-value corrections: Benjamini-Hochberg FDR (ported from Morpheus.js, BSD-3) and Bonferroni.

## Getting started

### Run in the browser (development)

```bash
npm install
npm run dev
```

Open http://localhost:5173 and drag a matrix file onto the drop zone.

### Build for deployment

```bash
npm run build   # output goes to dist/
```

Deploy the `dist/` folder to GitHub Pages, Netlify, or any static host.

### Desktop app (Tauri)

```bash
npm run tauri build
```

Produces a native installer in `src-tauri/target/release/bundle/`:
- macOS: `.dmg`
- Windows: `.msi` / `.exe`
- Linux: `.AppImage`

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript + React + Vite |
| In-browser query | DuckDB-WASM |
| Heatmap render | WebGL (custom GLSL shader) |
| Annotation tracks | Canvas 2D |
| Statistics | Custom implementations + ports from Morpheus.js |
| Background compute | Web Workers |
| UI | Tailwind CSS + shadcn/ui |
| Desktop shell | Tauri v2 |

## Attribution

Portions of this code are derived from [Morpheus.js](https://github.com/cmap/morpheus.js)
(Connectivity Map and LINCS at the Broad Institute), used under the BSD 3-Clause License.
See [LICENSE.morpheus](LICENSE.morpheus) for the full license text.

## License

MIT
