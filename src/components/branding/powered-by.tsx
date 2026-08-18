'use client'

import React from 'react'
import { cn } from '@/lib/utils'

interface PoweredByProps {
  className?: string
  variant?: 'default' | 'inline' | 'badge'
}

/**
 * "Powered by BAGMUL" branding component.
 * Used on landing footer, sidebar, login, register, and email footers
 * to credit the platform provider.
 */
export function PoweredBy({ className, variant = 'default' }: PoweredByProps) {
  if (variant === 'badge') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-muted-foreground',
          className
        )}
      >
        <span className="size-1.5 rounded-full bg-gradient-to-r from-primary to-primary/60" />
        Powered by{' '}
        <span className="font-bold tracking-wide bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
          BAGMUL
        </span>
      </span>
    )
  }

  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
        Powered by{' '}
        <span className="font-bold tracking-wide bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
          BAGMUL
        </span>
      </span>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground',
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-gradient-to-r from-primary to-primary/60 animate-pulse" />
      <span>Powered by</span>
      <span className="font-bold tracking-wider bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
        BAGMUL
      </span>
    </div>
  )
}

export default PoweredBy
