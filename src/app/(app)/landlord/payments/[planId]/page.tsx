'use client'

import { use } from 'react'
import PlanWorkspace from '@/components/payments/PlanWorkspace'

/**
 * Standalone rent ledger. The same workspace is embedded in the lease hub's
 * Payments tab — this route stays so existing links and bookmarks keep working.
 */
export default function PlanDetailPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params)
  return <PlanWorkspace planId={planId} />
}
