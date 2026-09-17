export interface SegmentedCounterItem {
  label: string
  count: number
}

export interface SegmentedCounterProps {
  items: SegmentedCounterItem[]
  activeIndex: number
  onSelect: (index: number) => void
}

export function SegmentedCounter({ items, activeIndex, onSelect }: SegmentedCounterProps) {
  return (
    <div className="flex overflow-x-auto rounded-lg border border-border bg-bg-card">
      {items.map((item, i) => {
        const active = i === activeIndex
        return (
          <button
            key={item.label}
            onClick={() => onSelect(i)}
            className={`relative flex min-w-[120px] flex-1 flex-col items-center gap-0.5 px-5 py-3 transition-colors ${
              active ? 'bg-blue-50' : 'hover:bg-slate-50'
            }`}
          >
            <span
              className={`text-xl font-bold ${active ? 'text-primary' : 'text-text-primary'}`}
            >
              {item.count}
            </span>
            <span className="label-caps">{item.label}</span>
            {active && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" aria-hidden />
            )}
          </button>
        )
      })}
    </div>
  )
}
