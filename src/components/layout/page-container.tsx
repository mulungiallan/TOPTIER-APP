/**
 * src/components/layout/page-container.tsx
 *
 * One shared container for every page, so horizontal rhythm (max-width,
 * padding) is identical across the app instead of each page hand-rolling
 * its own. Also bakes in safe-area insets for the Capacitor Android wrapper
 * and reserves space for a fixed bottom nav bar, so content never renders
 * underneath either.
 */

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const MAX_WIDTH_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  full: 'max-w-full',
} as const;

interface PageContainerProps {
  children: ReactNode;
  maxWidth?: keyof typeof MAX_WIDTH_MAP;
  className?: string;
  /** Set true for pages that manage their own full-height layout (e.g. a
   * chat/messages view) instead of normal document flow. */
  fullHeight?: boolean;
}

export function PageContainer({ children, maxWidth = '5xl', className, fullHeight = false }: PageContainerProps) {
  return (
    <div
      className={cn(
        'w-full mx-auto',
        'px-3 sm:px-4 md:px-6',
        // Status bar space is now reserved natively by Android
        // (StatusBar overlaysWebView: false) — no safe-area-inset-top padding
        // needed. Bottom/left/right safe areas stay for the gesture bar and
        // landscape notch cutouts, which aren't affected by that overlay bug.
        'pt-3 md:pt-6',
        fullHeight
          ? 'h-[calc(100dvh-var(--bottom-nav-height))]'
          : 'pb-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1rem)] md:pb-8',
        MAX_WIDTH_MAP[maxWidth],
        className
      )}
      style={{
        paddingLeft: 'max(0.75rem, var(--safe-left))',
        paddingRight: 'max(0.75rem, var(--safe-right))',
      }}
    >
      {children}
    </div>
  );
}