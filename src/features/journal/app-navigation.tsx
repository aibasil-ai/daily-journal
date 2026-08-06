import type { JSX } from 'react'
import { zhTW } from '../../i18n/zh-TW'
import type { JournalView } from './view-preference'

export type AppNavigationProps = {
  view: JournalView
  onViewChange: (view: JournalView) => void
  onCreateEntry: () => void
  onExport: () => void
  onSignOut: () => void
}

const navigationItems: Array<{ view: JournalView, label: string, icon: string }> = [
  { view: 'timeline', label: zhTW.journal.timelineView, icon: 'timeline' },
  { view: 'calendar', label: zhTW.journal.calendarView, icon: 'calendar_month' },
  { view: 'categories', label: zhTW.categories.title, icon: 'category' },
]

export function AppNavigation({ view, onViewChange, onCreateEntry, onExport, onSignOut }: AppNavigationProps): JSX.Element {
  return (
    <div className="app-navigation">
      <aside className="app-navigation__sidebar">
        <p className="app-navigation__title">{zhTW.appTitle}</p>
        <NavigationItems ariaLabel="主要導覽" view={view} onViewChange={onViewChange} />
        <div className="app-navigation__actions">
          <button type="button" onClick={onCreateEntry}>
            <span className="material-symbols-outlined" aria-hidden="true">add</span>
            {zhTW.journal.createEntry}
          </button>
          <button type="button" onClick={onExport}>
            <span className="material-symbols-outlined" aria-hidden="true">file_download</span>
            {zhTW.journal.export}
          </button>
          <button type="button" onClick={onSignOut}>
            <span className="material-symbols-outlined" aria-hidden="true">logout</span>
            {zhTW.journal.signOut}
          </button>
        </div>
      </aside>
      <NavigationItems ariaLabel="行動主要導覽" className="app-navigation__mobile-bar" view={view} onViewChange={onViewChange} />
    </div>
  )
}

function NavigationItems({ ariaLabel, className, view, onViewChange }: {
  ariaLabel: string
  className?: string
  view: JournalView
  onViewChange: (view: JournalView) => void
}): JSX.Element {
  return (
    <nav aria-label={ariaLabel} className={className}>
      {navigationItems.map((item) => (
        <button key={item.view} type="button" aria-current={view === item.view ? 'page' : undefined} onClick={() => onViewChange(item.view)}>
          <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  )
}
