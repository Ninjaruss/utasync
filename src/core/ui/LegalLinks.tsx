import { LEGAL_PATHS } from '../legal'

interface Props {
  className?: string
  /** When true, links open in a new tab (useful inside the PWA shell). */
  external?: boolean
}

export function LegalLinks({ className = '', external = true }: Props) {
  const linkProps = external
    ? { target: '_blank' as const, rel: 'noopener noreferrer' }
    : {}

  return (
    <nav
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-white/35 ${className}`}
      aria-label="Legal"
    >
      <a
        href={LEGAL_PATHS.privacy}
        className="hover:text-white/70 underline underline-offset-2 transition-colors duration-150"
        {...linkProps}
      >
        Privacy Policy
      </a>
      <span aria-hidden className="text-white/20">·</span>
      <a
        href={LEGAL_PATHS.terms}
        className="hover:text-white/70 underline underline-offset-2 transition-colors duration-150"
        {...linkProps}
      >
        Terms of Service
      </a>
    </nav>
  )
}
