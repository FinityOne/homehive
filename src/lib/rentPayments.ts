// Shared rules for tenant-facing rent payments.
//
// The fee maths lives here so the amount quoted in the UI and the amount
// charged by the server come from one function. The server always recomputes —
// the client's number is a preview, never an instruction.

export type PayMethod = 'card' | 'ach'
export type SettledMethod = PayMethod | 'manual_zelle' | 'manual_other'

/** Surcharge passed to the tenant, as a fraction of the amount owed. */
export const FEE_RATES: Record<PayMethod, number> = {
  card: 0.05, // 5%
  ach: 0.02,  // 2%
}

export const METHOD_META: Record<SettledMethod, { label: string; short: string; color: string; bg: string }> = {
  card:         { label: 'Card',            short: 'Card',   color: '#6d28d9', bg: '#f5f3ff' },
  ach:          { label: 'Bank transfer',   short: 'ACH',    color: '#1d4ed8', bg: '#eff6ff' },
  manual_zelle: { label: 'Zelle (confirmed by landlord)', short: 'Zelle', color: '#0e7490', bg: '#ecfeff' },
  manual_other: { label: 'Recorded by landlord',          short: 'Manual', color: '#64748b', bg: '#f1f5f9' },
}

const toCents = (n: number) => Math.round(n * 100)

export type FeeBreakdown = {
  baseCents: number
  feeCents: number
  totalCents: number
  base: number
  fee: number
  total: number
  ratePct: number
}

/**
 * Work in integer cents throughout. The fee rounds half-up on the cent, and the
 * total is base + fee — so what the tenant is told matches what Stripe captures
 * to the penny.
 */
export function computeFee(baseAmount: number, method: PayMethod): FeeBreakdown {
  const baseCents = toCents(baseAmount)
  const feeCents = Math.round(baseCents * FEE_RATES[method])
  const totalCents = baseCents + feeCents
  return {
    baseCents,
    feeCents,
    totalCents,
    base: baseCents / 100,
    fee: feeCents / 100,
    total: totalCents / 100,
    ratePct: FEE_RATES[method] * 100,
  }
}

export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** Outstanding balance on a payment row, never below zero. */
export function amountDue(p: { amount: number; paid_amount?: number | null }): number {
  return Math.max(0, Math.round(((p.amount ?? 0) - (p.paid_amount ?? 0)) * 100) / 100
  )
}

/** Stripe's smallest chargeable amount is 50 cents. */
export const MIN_CHARGE_CENTS = 50
