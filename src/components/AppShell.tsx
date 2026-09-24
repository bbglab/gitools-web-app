import type { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
  onBack?: () => void
}

export function AppShell({ children, onBack }: AppShellProps) {
  return (
    <div className="flex flex-col h-full bg-[--color-bg]">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-4 h-10 shrink-0 border-b border-[--color-border] bg-[--color-surface]">
        {onBack && (
          <button
            onClick={onBack}
            className="text-xs text-[--color-text-muted] hover:text-[--color-text] transition-colors"
          >
            ← Back
          </button>
        )}
        <span className="font-mono font-semibold text-sm tracking-wide text-[--color-accent]">
          gitools-web
        </span>
        <span className="text-xs text-[--color-text-muted] ml-1">
          genomics matrix explorer
        </span>
      </header>

      {/* Main content */}
      <main className="flex-1 min-h-0">
        {children}
      </main>
    </div>
  )
}
