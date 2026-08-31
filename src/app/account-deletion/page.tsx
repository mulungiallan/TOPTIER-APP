import type { Metadata } from 'next'
import { DataDeletionRequestPage } from '@/components/pages/data-deletion-request'

export const metadata: Metadata = {
  title: 'Account & Data Deletion Request — TOPTIER',
  description:
    'Request deletion of your TOPTIER account and personal data in accordance with applicable privacy laws.',
}

export default function AccountDeletionPage() {
  return <DataDeletionRequestPage />
}
