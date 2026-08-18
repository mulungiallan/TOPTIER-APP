import type { Metadata } from 'next'
import { PrivacyPolicyPage } from '@/components/pages/legal'

export const metadata: Metadata = {
  title: 'Privacy Policy — TOPTIER',
  description: 'TOPTIER privacy policy: how we collect, use, and protect your personal data.',
}

export default function PrivacyPage() {
  return <PrivacyPolicyPage />
}
