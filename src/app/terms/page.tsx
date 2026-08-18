import type { Metadata } from 'next'
import { TermsOfServicePage } from '@/components/pages/legal'

export const metadata: Metadata = {
  title: 'Terms of Service — TOPTIER',
  description: 'TOPTIER terms of service: the terms and conditions governing your use of the platform.',
}

export default function TermsPage() {
  return <TermsOfServicePage />
}
