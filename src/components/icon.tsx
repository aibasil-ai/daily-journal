type IconProps = {
  children: string
  filled?: boolean
  className?: string
}

export function Icon({ children, filled = false, className }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined${className ? ` ${className}` : ''}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {children}
    </span>
  )
}
