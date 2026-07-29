'use client'

import { useState } from 'react'
import { resolveServiceMark, type ServiceGlyph, type ServiceMarkQuery } from '@/lib/service-icons'

// Renders the mark lib/service-icons.ts resolves: brand logo, glyph, or an
// initials badge. Which mark a credential gets lives there, not here.

// Heroicons (outline) paths - match the stroke icons used elsewhere in the UI.
const GLYPH_PATHS: Record<ServiceGlyph, string> = {
  mail: 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75',
  key: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25z',
  server: 'M21.75 17.25v-.228a4.5 4.5 0 0 0-.12-1.03l-2.268-9.64a3.375 3.375 0 0 0-3.285-2.602H7.923a3.375 3.375 0 0 0-3.285 2.602l-2.268 9.64a4.5 4.5 0 0 0-.12 1.03v.228m19.5 0a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3m19.5 0a3 3 0 0 0-3-3H5.25a3 3 0 0 0-3 3m16.5 0h.008v.008h-.008v-.008Zm-3 0h.008v.008h-.008v-.008Z',
}

function initials(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9]/g, '')
  return (clean.slice(0, 2) || '?').toUpperCase()
}

interface ServiceIconProps extends ServiceMarkQuery {
  className?: string
}

export function ServiceIcon({ name, domain, glyph, className = '' }: ServiceIconProps) {
  const [failed, setFailed] = useState(false)
  const { src, glyph: resolvedGlyph } = resolveServiceMark({ name, domain, glyph })

  // Light chip backing so dark/filled marks (GitHub, Base, x.AI…) stay legible
  // against the near-black UI. Logos sit grayscale-and-calm, lifting to full
  // colour on row hover.
  const box = `inline-flex items-center justify-center w-[22px] h-[22px] rounded-sm overflow-hidden shrink-0 ring-1 ring-[rgba(250,250,250,0.14)] bg-[rgba(248,248,248,0.94)] ${className}`

  if (src && !failed) {
    return (
      <span className={box} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          width={16}
          height={16}
          onError={() => setFailed(true)}
          className="w-[16px] h-[16px] object-contain grayscale opacity-85 transition-[filter,opacity] duration-200 group-hover:grayscale-0 group-hover:opacity-100"
        />
      </span>
    )
  }

  if (resolvedGlyph) {
    return (
      <span className={box} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[13px] h-[13px] text-[rgba(10,10,10,0.55)]">
          <path strokeLinecap="round" strokeLinejoin="round" d={GLYPH_PATHS[resolvedGlyph]} />
        </svg>
      </span>
    )
  }

  return (
    <span className={`${box} font-mono text-[9px] tracking-tight text-[rgba(10,10,10,0.6)]`} aria-hidden="true">
      {initials(name ?? '')}
    </span>
  )
}
