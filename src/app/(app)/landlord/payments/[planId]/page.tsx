import { redirect } from 'next/navigation'

/**
 * The rent ledger is no longer a page of its own — every monetary view lives in
 * Financials, which opens the ledger inline at ?plan=. Kept as a redirect so
 * older links (emails, bookmarks) still land on the right money.
 */
export default async function PlanDetailRedirect({
  params,
}: {
  params: Promise<{ planId: string }>
}) {
  const { planId } = await params
  redirect(`/landlord/financials?plan=${planId}`)
}
