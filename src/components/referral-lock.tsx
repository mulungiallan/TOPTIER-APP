'use client'

import { Link2, ShieldAlert } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface ReferralLockBannerProps {
  message?: string | null
  referralUrl?: string | null
}

export function ReferralLockBanner({ message, referralUrl }: ReferralLockBannerProps) {
  return (
    <Card className="border-amber-400/40">
      <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-amber-500/15">
          <ShieldAlert className="size-7 text-amber-500" />
        </div>
        <div className="max-w-md space-y-1.5">
          <p className="font-display text-lg font-bold">Invite-only</p>
          <p className="text-sm text-muted-foreground">
            {message || 'This feature unlocks when you sign up through an active referral link.'}
          </p>
        </div>
        {referralUrl ? (
          <Button asChild>
            <a href={referralUrl} target="_blank" rel="noopener noreferrer">
              <Link2 className="size-4 mr-1.5" />
              Get access with a referral link
            </a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
