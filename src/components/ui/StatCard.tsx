export interface StatListItem {
  label: string
  /** Status dot color (any CSS color / tailwind token hex) */
  dotColor: string
  value?: string
}

export interface StatSubStat {
  label: string
  value: string
}

interface BaseProps {
  label: string
}

interface NumberVariant extends BaseProps {
  variant: 'number'
  value: string | number
}

interface ListVariant extends BaseProps {
  variant: 'list'
  items: StatListItem[]
}

interface ProgressVariant extends BaseProps {
  variant: 'progress'
  value: string | number
  /** 0-100 */
  progress: number
  subStats: [StatSubStat, StatSubStat]
}

export type StatCardProps = NumberVariant | ListVariant | ProgressVariant

export function StatCard(props: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-5">
      <div className="label-caps">{props.label}</div>

      {props.variant === 'number' && (
        <div className="mt-3 text-4xl font-bold text-text-primary">{props.value}</div>
      )}

      {props.variant === 'list' && (
        <ul className="mt-3 space-y-2.5">
          {props.items.map((item) => (
            <li key={item.label} className="flex items-center gap-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.dotColor }}
              />
              <span className="text-text-primary">{item.label}</span>
              {item.value && (
                <span className="ml-auto font-medium text-text-secondary">{item.value}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {props.variant === 'progress' && (
        <div className="mt-3">
          <div className="text-4xl font-bold text-text-primary">{props.value}</div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, props.progress))}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            {props.subStats.map((sub) => (
              <div key={sub.label}>
                <div className="label-caps">{sub.label}</div>
                <div className="mt-0.5 text-sm font-semibold text-text-primary">{sub.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
