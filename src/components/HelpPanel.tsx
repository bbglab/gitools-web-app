import { useState } from 'react'

type Tab = 'start' | 'stats' | 'keys'

interface Props {
  onClose: () => void
  isDark: boolean
}

export function HelpPanel({ onClose, isDark }: Props) {
  const [tab, setTab] = useState<Tab>('start')

  const bg       = isDark ? '#0a0a12' : '#ffffff'
  const surface  = isDark ? '#10101e' : '#f5f5f5'
  const border   = isDark ? '#2a2a45' : '#e0e0e0'
  const text     = isDark ? '#e2e8f0' : '#1a1a1a'
  const muted    = isDark ? '#6b7280' : '#6b7280'
  const accent   = isDark ? '#a0a8ff' : '#2563eb'
  const tabActive  = isDark ? { background: '#2a2a6e', color: '#a0a8ff', borderColor: '#4040a0' }
                            : { background: '#dbeafe', color: '#1d4ed8', borderColor: '#93c5fd' }
  const tabIdle    = isDark ? { background: 'transparent', color: '#6b7280', borderColor: '#2a2a45' }
                            : { background: 'transparent', color: '#6b7280', borderColor: '#e0e0e0' }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="flex flex-col rounded-lg shadow-2xl overflow-hidden"
        style={{ background: bg, border: `1px solid ${border}`, width: 720, maxWidth: '95vw', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b"
          style={{ background: surface, borderColor: border }}>
          <span className="font-semibold text-sm" style={{ color: accent }}>gitools-web — Help</span>
          <button onClick={onClose} className="text-lg leading-none px-1 hover:opacity-70" style={{ color: muted }}>×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-5 pt-3 shrink-0">
          {([
            ['start', 'Getting started'],
            ['stats', 'Statistics guide'],
            ['keys',  'Controls & shortcuts'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className="px-3 py-1 rounded text-xs font-mono border transition-colors"
              style={tab === t ? tabActive : tabIdle}>
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 text-xs font-mono" style={{ color: text }}>

          {/* ── Getting started ── */}
          {tab === 'start' && (
            <div className="flex flex-col gap-4">

              <Section title="1. Load a matrix" accent={accent} border={border}>
                <p>Drag and drop your data file onto the drop zone. Supported formats:</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li><b style={{ color: text }}>GCT v1.2 / v1.3</b> — Broad Institute format, single or multi-series</li>
                  <li><b style={{ color: text }}>TSV / TXT</b> — tab-separated, first column = gene/row IDs, first row = sample/column IDs</li>
                  <li><b style={{ color: text }}>Parquet / Arrow IPC</b> — binary columnar format for large matrices</li>
                </ul>
                <p className="mt-1">A preview shows dimensions and the first rows before opening. Click <b>Open</b> to load.</p>
              </Section>

              <Section title="2. Navigate the heatmap" accent={accent} border={border}>
                <p>The heatmap uses a diverging <b>Blue – White – Red</b> color scale: blue = low values, white = zero/midpoint, red = high values.</p>
                <p className="mt-1">Navigate with the mouse:</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li><b style={{ color: text }}>Scroll</b> — move up/down through rows</li>
                  <li><b style={{ color: text }}>Shift + scroll</b> — move left/right through columns</li>
                  <li><b style={{ color: text }}>Ctrl + scroll</b> — zoom in/out</li>
                  <li><b style={{ color: text }}>Drag</b> — pan freely</li>
                  <li><b style={{ color: text }}>Hover over a cell</b> — tooltip shows gene name, sample name, and all series values</li>
                </ul>
              </Section>

              <Section title="3. Sort rows and columns" accent={accent} border={border}>
                <ul className="list-disc ml-4 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li><b style={{ color: text }}>Click a column label</b> — sort all genes by that sample's values (toggle ↑↓)</li>
                  <li><b style={{ color: text }}>Click a gene label</b> — sort all samples by that gene's values (toggle ↑↓)</li>
                  <li><b style={{ color: text }}>Shift + click column labels</b> — select multiple columns; a bar appears to sort genes by the <i>sum</i> across selected columns (high→low or low→high)</li>
                  <li><b style={{ color: text }}>Shift + click gene labels</b> — select multiple genes; sort samples by sum across those genes</li>
                </ul>
              </Section>

              <Section title="4. Add annotations" accent={accent} border={border}>
                <p>Open the <b>▶ Annotations</b> sidebar (top-left button). Drag a tab-separated annotation file onto the <i>Column annotations</i> or <i>Row annotations</i> drop zone.</p>
                <p className="mt-1">The file must have sample/gene IDs in the first column matching those in the matrix. Each additional column becomes an annotation field.</p>
                <p className="mt-1">Once loaded you can:</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li>Toggle visibility with the checkbox next to each field</li>
                  <li>Sort the heatmap by an annotation field using <b style={{ color: text }}>↑ ↓</b></li>
                  <li>Filter by clicking on the annotation track strip in the heatmap</li>
                  <li>Click <b style={{ color: text }}>▶</b> to expand a field and show/hide individual categories</li>
                </ul>
                <p className="mt-2"><b>Choosing how to display an annotation</b></p>
                <p className="mt-1">Each annotation has a <b style={{ color: text }}>C / T</b> toggle button (right of the field name):</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li><b style={{ color: text }}>C (color)</b> — the default. Each value is drawn as a colored block. Categorical annotations get automatic distinct colors; numeric annotations get a gradient.</li>
                  <li><b style={{ color: text }}>T (text)</b> — the annotation track renders the actual value label for each cell instead of a color block. Useful when the annotation is a short code or number you need to read directly.</li>
                </ul>
                <p className="mt-2"><b>Changing category colors</b></p>
                <p className="mt-1">In <b style={{ color: text }}>C (color)</b> mode, click <b style={{ color: text }}>▶</b> to expand the field. Each category value shows a small colored square to its left — click it to open a color picker and choose a custom color. The change is applied immediately to the annotation track.</p>
              </Section>

              <Section title="5. Filter rows / columns" accent={accent} border={border}>
                <p>Click <b>⊘ Filter</b> in the toolbar to open the filter panel. Filters are applied instantly and shown in the status bar above the heatmap.</p>
                <p className="mt-2"><b>Filter by value</b> — keep only rows (genes) or columns (samples) whose aggregate statistic meets a condition. Each rule has three parts:</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li><b style={{ color: text }}>Aggregate</b> — what to compute across the row/column: mean, min, max, or <b style={{ color: text }}>% empty</b> (percentage of cells that have no value)</li>
                  <li><b style={{ color: text }}>Operator</b> — the comparison: &lt; &gt; ≤ ≥ = ≠</li>
                  <li><b style={{ color: text }}>Threshold</b> — the numeric cutoff</li>
                  <li><b style={{ color: text }}>Series</b> — which data layer to compute on (if the file has multiple)</li>
                </ul>
                <p className="mt-2"><b>Understanding % empty</b></p>
                <p className="mt-1" style={{ color: muted }}>
                  <b style={{ color: text }}>% empty</b> is the fraction of cells with no value (NaN), expressed as a percentage from 0 to 100.
                  Use <b style={{ color: text }}>&lt;</b> with a threshold to keep rows/columns that are not too sparse:
                </p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li><b style={{ color: text }}>% empty &lt; 100</b> — remove only completely empty rows/columns (very permissive)</li>
                  <li><b style={{ color: text }}>% empty &lt; 50</b> — keep only rows/columns that have data in at least half the cells</li>
                  <li><b style={{ color: text }}>% empty &lt; 20</b> — keep only well-covered rows/columns</li>
                </ul>
                <p className="mt-2"><b>Filter by ID list</b> — paste a list of gene or sample IDs (one per line) to include or exclude them exactly.</p>
                <p className="mt-2"><b>Rows vs. columns</b> — use the <b style={{ color: text }}>Rows</b> and <b style={{ color: text }}>Columns</b> tabs to set filters independently for each axis. Both can be active at the same time. The status bar shows how many rows and columns remain.</p>
                <p className="mt-2">You can add multiple rules per axis — all rules must pass for a row/column to be kept. Click <b style={{ color: text }}>Clear row/column filters</b> to reset.</p>
              </Section>

              <Section title="6. Search" accent={accent} border={border}>
                <p>Type a gene name in the <b>Search gene…</b> box in the toolbar. Matching rows are highlighted and the view scrolls to the first match automatically.</p>
              </Section>

              <Section title="7. Compare groups" accent={accent} border={border}>
                <p>Click <b>⚖ Compare Groups</b> to open the statistical comparison panel. You need column annotations loaded first.</p>
                <ol className="list-decimal ml-4 mt-1 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li>Select an <b style={{ color: text }}>annotation field</b> (e.g. disease, treatment)</li>
                  <li>Click <b style={{ color: text }}>A</b> / <b style={{ color: text }}>B</b> to assign categories to Group A and Group B</li>
                  <li>Choose a <b style={{ color: text }}>statistical test</b> and a <b style={{ color: text }}>correction method</b></li>
                  <li>Click <b style={{ color: text }}>Run comparison</b></li>
                </ol>
                <p className="mt-1">Results appear as a volcano plot and a ranked gene table. Click any gene in the table to highlight it in the heatmap. Click <b>Add as row annotations</b> to keep the scores permanently.</p>
              </Section>

              <Section title="8. Export data" accent={accent} border={border}>
                <p>Three export options are available in the toolbar:</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-1" style={{ color: muted }}>
                  <li>
                    <b style={{ color: text }}>↓ Export PNG</b> — renders the heatmap to a PNG image.
                    A dialog lets you set the output width and height (in pixels) and choose a white or dark background.
                    The image always shows the full set of currently visible rows and columns (after filters), at full resolution regardless of screen zoom.
                  </li>
                  <li>
                    <b style={{ color: text }}>↓ Export GCT</b> — downloads a GCT v1.2 file of the current view:
                    the filtered rows and columns in their current sort order, using the active data series.
                    The file can be opened in any tool that reads GCT format (Morpheus, GSEA, R/Python).
                  </li>
                  <li>
                    <b style={{ color: text }}>Export TSV</b> (in the Compare Groups results panel) — downloads the ranked gene table
                    (gene · score · p-value · FDR · mean A · mean B) as a tab-separated file.
                  </li>
                </ul>
              </Section>

              <Section title="9. Sessions — save and restore your work" accent={accent} border={border}>
                <p>Sessions let you save your entire analysis state and reload it in a later visit — without having to redo sorting, filtering, or comparison setup.</p>
                <p className="mt-2"><b>What a session saves:</b></p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5" style={{ color: muted }}>
                  <li>All annotation fields (including any you drag-dropped or added from comparison results)</li>
                  <li>Sort order of rows and columns</li>
                  <li>Active filters (annotation, value, ID-list)</li>
                  <li>Visible annotation tracks, display modes, and custom category colors</li>
                  <li>Color scale settings (preset, min/max overrides)</li>
                  <li>Active series, dark/light mode</li>
                </ul>
                <p className="mt-2"><b>Note:</b> the raw matrix data is <i>not</i> stored in the session file — it is usually large. Load your data file first, then load the session on top to restore the view.</p>
                <p className="mt-2"><b>To save:</b> click <b style={{ color: text }}>↓ Save Session</b>. A <code style={{ color: accent }}>.gitools.json</code> file is downloaded.</p>
                <p className="mt-1"><b>To restore:</b> load the same data file first, then click <b style={{ color: text }}>↑ Load Session</b> and pick the saved JSON. The viewer validates that the file dimensions match before applying any changes.</p>
                <p className="mt-2"><b>Shareable URL:</b> The URL automatically encodes your color scale preset, dark/light mode, and active series in the page hash (e.g. <code style={{ color: accent }}>#cmap=viridis&dark=1</code>). Bookmarking the URL or sharing it preserves those visual preferences — but the data file still needs to be re-loaded.</p>
              </Section>

            </div>
          )}

          {/* ── Statistics guide ── */}
          {tab === 'stats' && (
            <div className="flex flex-col gap-4">

              <p style={{ color: muted }}>
                In a group comparison, each gene (row) is tested independently. The score and p-value
                describe how differently that gene behaves between Group A and Group B.
                A <b style={{ color: text }}>positive score</b> means the gene tends to be higher in Group A;
                a <b style={{ color: text }}>negative score</b> means it is higher in Group B.
              </p>

              <Section title="T-test (Welch's)" accent={accent} border={border}>
                <Tag label="parametric" color="#7c3aed" />
                <p className="mt-1"><b>What it does:</b> Compares the <i>means</i> of the two groups, taking into account
                  that the groups may have different variances and different sizes (Welch's correction).</p>
                <p className="mt-1"><b>Score:</b> t-statistic. Large positive t → gene is higher in A; large negative t → gene is higher in B.</p>
                <p className="mt-1"><b>P-value:</b> Two-sided, from the t-distribution.</p>
                <p className="mt-1"><b>Assumption:</b> Values within each group are approximately normally distributed. Works well for log-transformed expression data.</p>
                <p className="mt-1"><b>When to use:</b> Standard choice for RNA-seq or microarray data where normality is reasonable.</p>
              </Section>

              <Section title="Mann-Whitney U (Wilcoxon rank-sum)" accent={accent} border={border}>
                <Tag label="non-parametric" color="#0f766e" />
                <p className="mt-1"><b>What it does:</b> Ranks all values from both groups together, then tests
                  whether Group A values tend to have higher or lower ranks than Group B. It does <i>not</i> compare means directly.</p>
                <p className="mt-1"><b>Score:</b> Z-statistic (normal approximation with tie correction).</p>
                <p className="mt-1"><b>P-value:</b> Two-sided.</p>
                <p className="mt-1"><b>Assumption:</b> None about the distribution shape — only that observations are independent.</p>
                <p className="mt-1"><b>When to use:</b> When you cannot assume normality, when groups are small, or when data contain many ties. Recommended for most gene expression comparisons.</p>
              </Section>

              <Section title="Signal-to-noise ratio (SNR)" accent={accent} border={border}>
                <Tag label="score only" color="#b45309" />
                <p className="mt-1"><b>What it does:</b> Measures how separated the two group distributions are relative to their own spread:</p>
                <Code isDark={isDark}>SNR = (mean_A − mean_B) / (std_A + std_B)</Code>
                <p className="mt-1"><b>Score:</b> SNR value. A high absolute value means the groups are well-separated compared to their internal variation.</p>
                <p className="mt-1"><b>P-value:</b> Not computed — use permutation testing (planned) for significance.</p>
                <p className="mt-1"><b>When to use:</b> Ranking genes by separation quality before a permutation test, or when p-values are not needed (e.g. for GSEA pre-ranked input).</p>
              </Section>

              <Section title="Fold change (log₂)" accent={accent} border={border}>
                <Tag label="score only" color="#b45309" />
                <p className="mt-1"><b>What it does:</b> Computes how many times higher the mean of Group A is compared to Group B, on a log₂ scale:</p>
                <Code isDark={isDark}>log₂FC = log₂(mean_A / mean_B)</Code>
                <p className="mt-1"><b>Score:</b> log₂ fold change. +1 = 2× higher in A; −1 = 2× higher in B; 0 = no change.</p>
                <p className="mt-1"><b>P-value:</b> Not computed.</p>
                <p className="mt-1"><b>When to use:</b> Quick intuitive magnitude of change. Combine with T-test or Mann-Whitney results to filter by both significance and effect size.</p>
              </Section>

              <Section title="Fisher exact test" accent={accent} border={border}>
                <Tag label="non-parametric" color="#0f766e" />
                <p className="mt-1"><b>What it does:</b> Tests whether the proportion of "positive" events (value &gt; 0) differs between the two groups. Designed for <i>binary data</i> (e.g. mutated vs. not mutated).</p>
                <p className="mt-1"><b>Score:</b> Difference in proportions (proportion_A − proportion_B).</p>
                <p className="mt-1"><b>P-value:</b> Exact hypergeometric p-value (two-sided).</p>
                <p className="mt-1"><b>When to use:</b> Mutation matrices, pathway membership, or any binary (0/1) data.</p>
              </Section>

              <Section title="Z-score / Stouffer's method" accent={accent} border={border}>
                <Tag label="meta-analysis" color="#1d4ed8" />
                <p className="mt-1"><b>What it does:</b> Combines individual p-values from Group A into a single Z-score using Stouffer's weighted sum. Useful when the matrix values <i>are already p-values</i>.</p>
                <Code isDark={isDark}>Z = Σ Φ⁻¹(1 − p_i) / √n</Code>
                <p className="mt-1"><b>Score:</b> Combined Z-statistic.</p>
                <p className="mt-1"><b>When to use:</b> When loading a matrix of p-values (e.g. from a pathway enrichment analysis) and you want to summarise evidence across samples.</p>
              </Section>

              <div className="border-t pt-4" style={{ borderColor: border }}>
                <div className="font-semibold mb-3" style={{ color: accent }}>Multiple testing correction</div>

                <p style={{ color: muted }}>
                  When you test thousands of genes simultaneously, some will appear significant <i>purely by chance</i>.
                  For example, at p &lt; 0.05 you expect 5% of all tested genes to look significant even if none truly are.
                  With 10,000 genes that means ~500 false positives. Correction methods control this.
                </p>

                <div className="mt-3 flex flex-col gap-3">
                  <div className="rounded p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                    <div className="font-semibold mb-1" style={{ color: text }}>Benjamini-Hochberg FDR <span style={{ color: muted, fontWeight: 'normal' }}>(recommended)</span></div>
                    <p style={{ color: muted }}>Controls the <b style={{ color: text }}>False Discovery Rate (FDR)</b> — the expected fraction of significant results
                      that are actually false positives. An FDR of 0.05 means: among all genes you call significant,
                      at most 5% are expected to be false. Less conservative than Bonferroni; keeps more true positives.
                      The corrected value is often called the <b style={{ color: text }}>q-value</b>.</p>
                  </div>

                  <div className="rounded p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                    <div className="font-semibold mb-1" style={{ color: text }}>Bonferroni</div>
                    <p style={{ color: muted }}>Controls the <b style={{ color: text }}>Family-Wise Error Rate (FWER)</b> — the probability of making
                      even one false positive. Divides the significance threshold by the number of tests
                      (adjusted p = raw p × n_tests). Very conservative — may miss true positives when
                      testing many genes. Use when a single false positive would be very costly.</p>
                  </div>

                  <div className="rounded p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                    <div className="font-semibold mb-1" style={{ color: text }}>None (raw p-values)</div>
                    <p style={{ color: muted }}>No correction applied. Only appropriate when testing a very small number of pre-selected hypotheses. Never use for genome-wide analysis.</p>
                  </div>
                </div>

                <p className="mt-3" style={{ color: muted }}>
                  <b style={{ color: text }}>Rule of thumb:</b> Use BH FDR for exploratory analysis (FDR &lt; 0.05 or 0.10 is common).
                  Use Bonferroni only when you need very strict control. Always report which correction you used.
                </p>
              </div>

              <div className="border-t pt-4" style={{ borderColor: border }}>
                <div className="font-semibold mb-2" style={{ color: accent }}>Volcano plot</div>
                <p style={{ color: muted }}>
                  The volcano plot shows <b style={{ color: text }}>score</b> on the x-axis and <b style={{ color: text }}>−log₁₀(FDR)</b> on the y-axis.
                  Genes high on the plot have small FDR (more significant). Genes far left/right have a large effect.
                  The most interesting genes are in the upper-left and upper-right corners (large effect AND significant).
                  Click any dot to highlight that gene in the heatmap.
                </p>
              </div>

            </div>
          )}

          {/* ── Controls & shortcuts ── */}
          {tab === 'keys' && (
            <div className="flex flex-col gap-4">

              <Section title="Mouse controls" accent={accent} border={border}>
                <table className="w-full border-collapse">
                  <tbody>
                    {[
                      ['Scroll',              'Move up/down through rows'],
                      ['Shift + scroll',      'Move left/right through columns'],
                      ['Ctrl + scroll',       'Zoom in/out (both axes)'],
                      ['Drag',                'Pan the heatmap freely'],
                      ['Hover over cell',     'Show gene, sample, and values in tooltip'],
                      ['Click column label',  'Sort genes by that sample (click again to reverse)'],
                      ['Click gene label',    'Sort samples by that gene (click again to reverse)'],
                      ['Shift + click label', 'Add column/row to sum-sort selection'],
                    ].map(([key, desc]) => (
                      <tr key={key} className="border-b" style={{ borderColor: border }}>
                        <td className="py-1.5 pr-4 whitespace-nowrap" style={{ color: accent }}>{key}</td>
                        <td className="py-1.5" style={{ color: muted }}>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title="Toolbar buttons" accent={accent} border={border}>
                <table className="w-full border-collapse">
                  <tbody>
                    {[
                      ['▶ Annotations',    'Open/close the annotation sidebar (load TSV, sort, filter)'],
                      ['Series buttons',   'Switch between data layers if the file has multiple series (GCT v1.3)'],
                      ['Search gene…',     'Highlight matching rows and scroll to first match'],
                      ['⊘ Filter',         'Open the filter panel — filter rows/columns by value, % empty, or ID list'],
                      ['⚖ Compare Groups', 'Open the group comparison panel'],
                      ['↓ Export PNG',     'Download the current heatmap view as a PNG image (custom pixel dimensions)'],
                      ['↓ Export GCT',     'Download the filtered view as a GCT v1.2 file (active series, current sort order)'],
                      ['↓ Save Session',   'Save annotations, sort order, filters, and view settings as a JSON file'],
                      ['↑ Load Session',   'Restore a previously saved session JSON on top of the currently loaded data'],
                      ['Light / Dark',     'Toggle background colour (also encoded in the bookmarkable URL hash)'],
                    ].map(([key, desc]) => (
                      <tr key={key} className="border-b" style={{ borderColor: border }}>
                        <td className="py-1.5 pr-4 whitespace-nowrap" style={{ color: accent }}>{key}</td>
                        <td className="py-1.5" style={{ color: muted }}>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title="Annotation sidebar" accent={accent} border={border}>
                <table className="w-full border-collapse">
                  <tbody>
                    {[
                      ['Checkbox',            'Show/hide the annotation track in the heatmap'],
                      ['▶ expand',            'Show individual category values to filter on/off, and color swatches'],
                      ['C / T toggle',        'Switch between color mode (colored blocks) and text mode (value labels)'],
                      ['Color swatch',        'In C mode: click the small square next to a category value to change its color'],
                      ['↑ / ↓ arrows',        'Sort all rows or columns by this annotation field'],
                      ['● orange dot',        'Filter is active on this field'],
                      ['× button',            'Clear filter for that field'],
                      ['Click track strip',   'Quick-filter: show only columns/rows with that value'],
                      ['Drop TSV here',       'Drag a new annotation file to add more fields'],
                    ].map(([key, desc]) => (
                      <tr key={key} className="border-b" style={{ borderColor: border }}>
                        <td className="py-1.5 pr-4 whitespace-nowrap" style={{ color: accent }}>{key}</td>
                        <td className="py-1.5" style={{ color: muted }}>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title="File formats" accent={accent} border={border}>
                <table className="w-full border-collapse">
                  <tbody>
                    {[
                      ['GCT v1.2',      'Tab-separated, 2 header rows, one data layer'],
                      ['GCT v1.3',      'Multi-layer: multiple series per cell (e.g. expression + p-value)'],
                      ['TSV / TXT',     'Tab-separated table; first column = IDs, first row = sample IDs'],
                      ['Parquet/Arrow', 'Binary columnar format; fastest for large matrices'],
                      ['CLS',          'Class label file; maps sample IDs to group names (Broad format)'],
                      ['Annotation TSV','First column = IDs matching the matrix; remaining columns = fields'],
                    ].map(([key, desc]) => (
                      <tr key={key} className="border-b" style={{ borderColor: border }}>
                        <td className="py-1.5 pr-4 whitespace-nowrap" style={{ color: accent }}>{key}</td>
                        <td className="py-1.5" style={{ color: muted }}>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Section({ title, accent, border, children }: {
  title: string; accent: string; border: string; children: React.ReactNode
}) {
  return (
    <div>
      <div className="font-semibold mb-2" style={{ color: accent }}>{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
      <div className="mt-3 border-b" style={{ borderColor: border }} />
    </div>
  )
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold mb-1"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
      {label}
    </span>
  )
}

function Code({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  return (
    <pre className="rounded px-3 py-2 my-1 text-[11px] overflow-x-auto"
      style={{ background: isDark ? '#0f0f22' : '#f0f0f0', color: isDark ? '#a0a8ff' : '#1d4ed8' }}>
      {children}
    </pre>
  )
}
