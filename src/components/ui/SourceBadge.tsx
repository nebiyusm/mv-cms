import { SOURCE_COLORS, type Platform } from '../../lib/sourceColors'

export interface SourceBadgeProps {
  platform: Platform
  /** Optional tooltip / accessible label override (defaults to platform name) */
  title?: string
}

export function SourceBadge({ platform, title }: SourceBadgeProps) {
  const source = SOURCE_COLORS[platform]
  return (
    <span
      title={title ?? source.label}
      aria-label={title ?? source.label}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none text-white"
      style={{ backgroundColor: source.bg }}
    >
      {source.letter}
    </span>
  )
}
