import type { Metadata } from 'next'
import { UgcPolicyPage } from '@/components/pages/legal'

export const metadata: Metadata = {
  title: 'Community Content Policy — TOPTIER',
  description: 'TOPTIER community content policy: what is allowed, how to report content, and how to appeal moderation decisions.',
}

export default function UgcPolicy() {
  return <UgcPolicyPage />
}