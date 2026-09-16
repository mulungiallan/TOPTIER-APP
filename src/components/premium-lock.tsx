'use client'

import { Crown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useStore } from '@/lib/store'

interface PremiumLockBannerProps {
  message?: string | null
}

export function PremiumLockBanner({ message }: PremiumLockBannerProps) {
  const setPage = useStore((s) => s.setPage)

  return (
    <Card className="border-primary/30">
      <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
          <Crown className="size-7 text-primary" />
        </div>
        <div className="max-w-md space-y-1.5">
          <p className="font-display text-lg font-bold">Premium Feature</p>
          <p className="text-sm text-muted-foreground">
            {message || 'Bot trading and copy trading unlock on a premium plan.'}
          </p>
        </div>
        <Button onClick={() => setPage('subscriptions')} className="gap-1.5">
          <Crown className="size-4" />
          Upgrade to Premium
        </Button>
      </CardContent>
    </Card>
  )
}