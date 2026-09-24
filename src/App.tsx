import { useState } from 'react'
import { AppShell } from './components/AppShell'
import { DropZone } from './components/DropZone'
import { LoadPreview } from './components/LoadPreview'
import { HeatmapViewer } from './components/viewer/HeatmapViewer'
import type { Dataset } from './core/Dataset'

type AppView = 'landing' | 'preview' | 'viewer'

export function App() {
  const [view, setView] = useState<AppView>('landing')
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [filename, setFilename] = useState<string>('')

  function handleDatasetLoaded(ds: Dataset, name: string) {
    setDataset(ds)
    setFilename(name)
    setView('preview')
  }

  function handleOpenMatrix() {
    setView('viewer')
  }

  function handleBack() {
    setDataset(null)
    setFilename('')
    setView('landing')
  }

  return (
    <AppShell onBack={view !== 'landing' ? handleBack : undefined}>
      {view === 'landing' && (
        <DropZone onDatasetLoaded={handleDatasetLoaded} />
      )}
      {view === 'preview' && dataset && (
        <LoadPreview
          dataset={dataset}
          filename={filename}
          onOpen={handleOpenMatrix}
          onBack={handleBack}
        />
      )}
      {view === 'viewer' && dataset && (
        <HeatmapViewer dataset={dataset} />
      )}
    </AppShell>
  )
}
