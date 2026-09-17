import type { ReactNode } from 'react'

export interface PageHeaderProps {
  /** Icon rendered inside the circular light-blue badge */
  icon: ReactNode
  title: string
  subtitle?: string
  /** Right-aligned contextual controls (date picker, search + button, ...) */
  actions?: ReactNode
}

export function PageHeader({ icon, title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-primary">
          {icon}
        </div>
        <div>
          <h1 className="text-[22px] font-bold leading-tight text-text-primary">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-text-secondary">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
