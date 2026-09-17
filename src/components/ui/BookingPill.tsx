import type { CSSProperties } from 'react'
import { SourceBadge } from './SourceBadge'
import { SOURCE_COLORS, type Platform } from '../../lib/sourceColors'

export interface BookingPillProps {
  guestName: string
  platform: Platform
  /**
   * Grid placement for a parent calendar grid, e.g.
   * `gridColumn: '3 / span 4'`. Applied to the pill's inline style.
   */
  gridColumn?: CSSProperties['gridColumn']
  /** Extra inline styles (width, margins, ...) */
  style?: CSSProperties
  className?: string
  onClick?: () => void
}

export function BookingPill({
  guestName,
  platform,
  gridColumn,
  style,
  className = '',
  onClick,
}: BookingPillProps) {
  const source = SOURCE_COLORS[platform]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      title={`${guestName} — ${source.label}`}
      className={`flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
      style={{
        backgroundColor: source.soft,
        color: source.text,
        borderLeft: `3px solid ${source.bg}`,
        gridColumn,
        ...style,
      }}
    >
      <SourceBadge platform={platform} />
      <span className="truncate">{guestName}</span>
    </Tag>
  )
}
