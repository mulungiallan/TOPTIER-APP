'use client'

import React from 'react'
import { cn } from '@/lib/utils'

interface BrandLogoProps {
  className?: string
  rounded?: string
}

/**
 * TOPTIER brand mark: a bold "T" lettermark on the brand gradient tile,
 * with a subtle ascending-candle pulse window to hint at trading.
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
        {/* Bold "T" */}
        <rect x="10" y="10" width="28" height="5" rx="1.2" fill="#ffffff" />
        <rect x="21.5" y="10" width="5" height="29" rx="1.2" fill="#67e8f9" />
      </svg>
    </span>
  )
}

export default BrandLogo
