import { useState } from 'react'
import { BedDouble, ChevronDown, Menu, LogOut } from 'lucide-react'

export interface TopNavLink {
  label: string
  path: string
}

export interface TopNavProps {
  properties: string[]
  selectedProperty: string
  onPropertyChange: (property: string) => void
  currencies: string[]
  selectedCurrency: string
  onCurrencyChange: (currency: string) => void
  links: TopNavLink[]
  activePath: string
  onNavigate: (path: string) => void
  /** Secondary sections shown inside the hamburger overflow menu */
  overflowLinks?: TopNavLink[]
  onLogout?: () => void
}

function NavSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
  ariaLabel: string
}) {
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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

export function TopNav({
  properties,
  selectedProperty,
  onPropertyChange,
  currencies,
  selectedCurrency,
  onCurrencyChange,
  links,
  activePath,
  onNavigate,
  overflowLinks = [],
  onLogout,
}: TopNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg-card">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        {/* Logo mark + wordmark */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white">
            <BedDouble className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-bold text-text-primary">Mad Vervet</div>
            <div className="text-[11px] text-text-secondary">Hostel management, simplified</div>
          </div>
        </div>

        {/* Property + currency selectors */}
        <div className="ml-4 hidden items-center gap-2 md:flex">
          <NavSelect
            ariaLabel="Property"
            value={selectedProperty}
            options={properties}
            onChange={onPropertyChange}
          />
          <NavSelect
            ariaLabel="Currency"
            value={selectedCurrency}
            options={currencies}
            onChange={onCurrencyChange}
          />
        </div>

        {/* Primary nav links */}
        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {links.map((link) => {
            const active = link.path === activePath
            return (
              <button
                key={link.path}
                onClick={() => onNavigate(link.path)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'text-primary'
                    : 'text-text-primary hover:bg-slate-100 hover:text-primary'
                }`}
              >
                {link.label}
              </button>
            )
          })}
        </nav>

        {/* Overflow hamburger menu */}
        <div className="relative ml-auto lg:ml-2">
          <button
            aria-label="More options"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-md p-2 text-text-primary hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-52 rounded-lg border border-border bg-bg-card py-1 shadow-lg">
                {overflowLinks.map((link) => (
                  <button
                    key={link.path}
                    onClick={() => {
                      onNavigate(link.path)
                      setMenuOpen(false)
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-slate-100"
                  >
                    {link.label}
                  </button>
                ))}
                {overflowLinks.length > 0 && <div className="my-1 border-t border-border" />}
                <button
                  onClick={() => {
                    onLogout?.()
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium text-danger hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
