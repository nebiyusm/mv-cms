export type Platform =
  | 'airbnb'
  | 'booking'
  | 'agoda'
  | 'expedia'
  | 'hostelworld'
  | 'direct'

export interface SourceColor {
  /** Solid badge/pill background */
  bg: string
  /** Soft tint used for pill backgrounds on the calendar */
  soft: string
  /** Text color on soft tint */
  text: string
  /** Single-letter / short label shown inside the badge */
  letter: string
  /** Human-readable platform name */
  label: string
}

/**
 * Fixed source -> color mapping. Keep this as the single source of truth so a
 * platform renders the same hue everywhere (calendar pills, activity table, etc).
 */
export const SOURCE_COLORS: Record<Platform, SourceColor> = {
  booking: {
    bg: '#2563EB', // blue-600
    soft: '#DBEAFE', // blue-100
    text: '#1E3A8A', // blue-900
    letter: 'B',
    label: 'Booking.com',
  },
  airbnb: {
    bg: '#F43F5E', // rose-500
    soft: '#FFE4E6', // rose-100
    text: '#881337', // rose-900
    letter: 'A',
    label: 'Airbnb',
  },
  expedia: {
    bg: '#F59E0B', // amber-500
    soft: '#FEF3C7', // amber-100
    text: '#78350F', // amber-900
    letter: 'E',
    label: 'Expedia',
  },
  agoda: {
    bg: '#6366F1', // indigo-500
    soft: '#E0E7FF', // indigo-100
    text: '#312E81', // indigo-900
    letter: 'Ag',
    label: 'Agoda',
  },
  hostelworld: {
    bg: '#F97316', // orange-500
    soft: '#FFEDD5', // orange-100
    text: '#7C2D12', // orange-900
    letter: 'H',
    label: 'Hostelworld',
  },
  direct: {
    bg: '#10B981', // emerald-500
    soft: '#D1FAE5', // emerald-100
    text: '#064E3B', // emerald-900
    letter: 'D',
    label: 'Direct / Walk-in',
  },
}
