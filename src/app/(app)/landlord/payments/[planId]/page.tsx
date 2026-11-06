import { redirect } from 'next/navigation'

/**
 * The rent ledger has moved twice now: it was `/landlord/payments/<planId>`,
 * then a panel inside Financials at `?plan=`, and it is now a route of its own
 * under Financials. This stub keeps the oldest links — emails, bookmarks,
 * anything a landlord saved — landing on the right money.
 */
export default async function PlanDetailRedirect({
  params,
}: {
  params: Promise<{ planId: string }>
}) {
  const { planId } = await params
  redirect(`/landlord/financials/plan/${planId}`)
}
