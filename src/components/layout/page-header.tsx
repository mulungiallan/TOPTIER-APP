/**
 * src/components/layout/page-header.tsx
 *
 * Replaces the ad hoc `<motion.div><h1 className="...flex items-center
 * gap-2">` block duplicated (with a different arbitrary accent color) at
 * the top of every page. One header treatment, one entrance animation
 * pattern for the whole app — actions wrap to their own row on narrow
 * screens instead of squeezing next to the title.
 */

'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ icon: Icon, title, description, actions, className }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}
    >
      <div className="min-w-0">
        <h1 className="font-display text-xl sm:text-2xl md:text-[1.75rem] font-medium tracking-tight text-text flex items-center gap-2.5 flex-wrap">
          <span className="inline-flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-slate border border-line">
            <Icon className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-brass" />
          </span>
          <span className="truncate">{title}</span>
        </h1>
        {description && (
          <p className="text-mist text-xs sm:text-sm mt-1.5 max-w-xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </motion.div>
  );
}