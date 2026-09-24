import type { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
  onBack?: () => void
}

export function AppShell({ children, onBack }: AppShellProps) {
  return (
    <div className="flex flex-col h-full bg-[--color-bg]">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-4 h-12 shrink-0 border-b border-[--color-border] bg-[--color-surface]">
        {onBack && (
          <button
            onClick={onBack}
            className="text-xs text-[--color-text-muted] hover:text-[--color-text] transition-colors"
          >
            ← Back
          </button>
        )}
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Gitools" className="h-8 w-auto" />
        <span className="text-xs text-[--color-text-muted]">
          interactive heatmap explorer
        </span>
      </header>

      {/* Main content */}
      <main className="flex-1 min-h-0">
        {children}
      </main>
    </div>
  )
}
