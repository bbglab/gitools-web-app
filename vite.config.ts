import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Base path for GitHub Pages — must match the repo name
  base: '/gitools-web-app/',

  // DuckDB-WASM must not be pre-bundled by Vite — it manages its own WASM loading
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },

  // Cross-Origin Isolation headers required for SharedArrayBuffer (DuckDB-WASM)
  // Tauri handles these headers via its own CSP config in src-tauri/tauri.conf.json
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // Tauri expects the dev server on port 5173
    port: 5173,
    strictPort: true,
  },

  // Prevent Vite from obscuring Rust errors in Tauri dev mode
  clearScreen: false,
})
