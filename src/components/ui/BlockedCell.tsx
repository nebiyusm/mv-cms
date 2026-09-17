import type { CSSProperties } from 'react'
import { Lock } from 'lucide-react'

export interface BlockedCellProps {
  /** Grid placement for a parent calendar grid, e.g. `gridColumn: '4 / span 2'` */
  gridColumn?: CSSProperties['gridColumn']
  style?: CSSProperties
  className?: string
  title?: string
}

export function BlockedCell({
  gridColumn,
  style,
  className = '',
  title = 'Blocked',
}: BlockedCellProps) {
  return (
    <div
      title={title}
      aria-label={title}
      className={`flex h-7 items-center justify-center rounded-md ${className}`}
      style={{
        backgroundColor: '#D1D5DB', // gray-300 base under the hatch
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(156,163,175,0.55) 0px, rgba(156,163,175,0.55) 4px, transparent 4px, transparent 9px)',
        gridColumn,
        ...style,
      }}
    >
      <Lock className="h-3.5 w-3.5 text-gray-500" />
    </div>
  )
}
