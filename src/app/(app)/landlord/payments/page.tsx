import { redirect } from 'next/navigation'

/**
 * The portfolio rent view moved to /landlord/financials when per-lease work
 * consolidated into the lease hub. Kept as a redirect so old links and
 * bookmarks still land somewhere sensible.
 */
export default function PaymentsRedirect() {
  redirect('/landlord/financials')
}
