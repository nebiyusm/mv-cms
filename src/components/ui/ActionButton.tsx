import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

export function ActionButton({ children, className = '', ...rest }: ActionButtonProps) {
  return (
    <button
      {...rest}
      className={`rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  )
}
