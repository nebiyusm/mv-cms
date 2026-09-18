import { ChevronDown } from 'lucide-react'

export interface StatusDropdownProps {
  options: string[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  /** Extra classes on the <select>, keyed by option value (e.g. status colors) */
  valueStyles?: Record<string, string>
  /** Larger padding/text for touch targets (default 'sm') */
  size?: 'sm' | 'lg'
}

export function StatusDropdown({
  options,
  value,
  onChange,
  ariaLabel = 'Status',
  valueStyles,
  size = 'sm',
}: StatusDropdownProps) {
  const sizing = size === 'lg' ? 'py-2.5 pl-3.5 pr-9 text-base' : 'py-1.5 pl-3 pr-8 text-sm'
  return (
    <div className="relative inline-block">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none rounded-md border border-gray-300 bg-bg-card ${sizing} text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${valueStyles?.[value] ?? ''}`}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </div>
  )
}
