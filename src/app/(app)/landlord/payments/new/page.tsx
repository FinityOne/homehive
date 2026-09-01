import { redirect } from 'next/navigation'

/**
 * Setting up rent collection is a money action, so the wizard now lives under
 * /landlord/financials/new. Kept as a redirect for old links and bookmarks.
 */
export default async function NewPlanRedirect({
  searchParams,
}: {
  searchParams: Promise<{ lease?: string }>
}) {
  const { lease } = await searchParams
  redirect(lease ? `/landlord/financials/new?lease=${lease}` : '/landlord/financials/new')
}
