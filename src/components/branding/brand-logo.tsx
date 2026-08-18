'use client'

import React from 'react'
import { cn } from '@/lib/utils'

interface BrandLogoProps {
  className?: string
  rounded?: string
}

/**
 * TOPTIER brand mark: a gradient tile with four ascending
 * candlesticks. The final candle is accented in cyan.
 */
export function BrandLogo({ className, rounded = 'rounded-lg' }: BrandLogoProps) {
  const gradientId = React.useId()

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden',
        rounded,
        className
      )}
    >
      <svg viewBox="0 0 48 48" className="size-full" role="img" aria-label="TOPTIER logo">
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="48"
            y2="48"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#2f6bc1" />
            <stop offset="1" stopColor="#16385e" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" fill={`url(#${gradientId})`} />
        <g stroke="#ffffff" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="24" x2="12" y2="37" />
          <line x1="20" y1="20" x2="20" y2="34" />
          <line x1="28" y1="16" x2="28" y2="31" />
          <line x1="36" y1="12" x2="36" y2="28" />
        </g>
        <rect x="9.5" y="27" width="5" height="9" rx="1.2" fill="#ffffff" />
        <rect x="17.5" y="23" width="5" height="10" rx="1.2" fill="#ffffff" />
        <rect x="25.5" y="19" width="5" height="11" rx="1.2" fill="#ffffff" />
        <rect x="33.5" y="15" width="5" height="12" rx="1.2" fill="#67e8f9" />
      </svg>
    </span>
  )
}

export default BrandLogo
