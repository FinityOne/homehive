import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import RenewalResponder from '@/components/renewals/RenewalResponder'
import { daysUntil, fmtDate, fmtRent, renewalState } from '@/lib/renewals'
import type { Renewal } from '@/lib/renewals'

/**
 * The tenant's renewal page.
 *
 * Outside every route group on purpose — no app nav, no landlord chrome, no
 * login. A tenant on this platform often has no account at all, so the token
 * in their email is the whole of the authentication, exactly as the move-out
 * report at /checkout-report/[token] works. The renewal tables stay owner-only
 * under RLS and this reads through the service role, so nothing is exposed
 * beyond the one offer the token names.
 *
 * It is written for a phone, read in under a minute, by someone deciding where
 * they live next year. So: the terms before the prose, the rent change named
 * out loud rather than left as arithmetic between two numbers, and one
 * decision. Every state an offer can be in gets its own honest page — an
 * expired link says it expired rather than quietly accepting a late yes.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your renewal offer — HomeHive',
  robots: { index: false, follow: false },
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Row = Renewal & {
  lease: {
    end_date: string
    rent_amount: number | null
    unit_number: string | null
    property: { name: string | null; address: string | null } | null
  } | null
}

export default async function RenewalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!UUID.test(token)) notFound()

  const { data } = await supabaseAdmin
    .from('lease_renewals')
    .select(`
      *,
      lease:leases (
        end_date, rent_amount, unit_number,
        property:properties ( name, address )
      )
    `)
    .eq('token', token)
    .maybeSingle()

  if (!data) notFound()

  const r = data as Row
  const state = renewalState(r)
  const propertyName = r.lease?.property?.name || 'your home'
  const currentRent = r.lease?.rent_amount == null ? null : Number(r.lease.rent_amount)
  const landlord = await supabaseAdmin
    .from('profiles').select('full_name, email').eq('id', r.owner_id).maybeSingle()

  const first = (r.tenant_name || '').trim().split(/\s+/)[0]
  const rentChange =
    currentRent && currentRent > 0 && r.new_rent !== currentRent
      ? { up: r.new_rent > currentRent, amount: Math.abs(r.new_rent - currentRent) }
      : null

  /** A closed offer gets a page that says so, not a decision it cannot take. */
  const closed: Record<string, { head: string; body: string; tone: string }> = {
    accepted: {
      head: 'You already said yes',
      body: `You accepted this renewal${r.responded_at ? ` on ${fmtDate(r.responded_at.slice(0, 10))}` : ''}. Your landlord will send the new lease to sign.`,
      tone: 'yes',
    },
    converted: {
      head: 'This renewal is done',
      body: 'You accepted it and the new lease has been created. Nothing more is needed here.',
      tone: 'yes',
    },
    declined: {
      head: 'You said you’re moving out',
      body: `You declined this renewal${r.responded_at ? ` on ${fmtDate(r.responded_at.slice(0, 10))}` : ''}. Your current lease is unaffected and runs to ${r.lease ? fmtDate(r.lease.end_date) : 'its end date'}. If you’ve changed your mind, get in touch with your landlord directly.`,
      tone: 'no',
    },
    withdrawn: {
      head: 'This offer was withdrawn',
      body: 'Your landlord pulled this offer, usually to send one on different terms. Keep an eye on your inbox, or get in touch with them.',
      tone: 'no',
    },
    expired: {
      head: 'This offer has expired',
      body: `The reply-by date was ${fmtDate(r.respond_by)}. Your current lease is unaffected — contact your landlord and they can send a new offer.`,
      tone: 'no',
    },
  }

  const closedCopy = closed[state]

  return (
    <main className="rp">
      <style>{CSS}</style>

      <div className="rp-card">
        <div className="rp-brand">
          Home<span>Hive</span>
        </div>

        <div className="rp-banner">
          <div className="rp-banner-k">Renewal offer</div>
          <div className="rp-banner-v">
            {propertyName}{r.lease?.unit_number ? ` · ${r.lease.unit_number}` : ''}
          </div>
          {r.lease?.property?.address && <div className="rp-addr">{r.lease.property.address}</div>}
        </div>

        <div className="rp-body">
          {closedCopy ? (
            <div className={`rp-closed ${closedCopy.tone}`}>
              <div className="rp-closed-h">{closedCopy.head}</div>
              <p>{closedCopy.body}</p>
            </div>
          ) : (
            <>
              <p className="rp-lede">
                {first ? `${first}, your` : 'Your'} lease{r.lease ? ` ends on ${fmtDate(r.lease.end_date)}` : ' is ending'}
                {landlord.data?.full_name ? ` and ${landlord.data.full_name} would` : ' and your landlord would'} like
                you to stay. Here are the terms.
              </p>

              <dl className="rp-terms">
                <div>
                  <dt>Rent</dt>
                  <dd>
                    <strong>{fmtRent(r.new_rent)}</strong> / month
                    {rentChange && (
                      <span className={`rp-delta ${rentChange.up ? 'up' : 'down'}`}>
                        {rentChange.up ? '↑' : '↓'} {fmtRent(rentChange.amount)} from {fmtRent(currentRent!)}
                      </span>
                    )}
                    {!rentChange && currentRent ? <span className="rp-delta same">no change</span> : null}
                  </dd>
                </div>
                <div>
                  <dt>New term</dt>
                  <dd>{fmtDate(r.new_start_date)} — {fmtDate(r.new_end_date)}</dd>
                </div>
                <div>
                  <dt>Reply by</dt>
                  <dd>
                    {fmtDate(r.respond_by)}
                    <span className="rp-delta">
                      {(() => {
                        const d = daysUntil(r.respond_by)
                        return d === 0 ? 'today' : d === 1 ? '1 day left' : `${d} days left`
                      })()}
                    </span>
                  </dd>
                </div>
              </dl>

              {r.message?.trim() && (
                <blockquote className="rp-msg">{r.message.trim()}</blockquote>
              )}

              <ul className="rp-why">
                <li>No new deposit, no application, no moving costs.</li>
                <li>Same room, same roommates, same commute.</li>
                <li>Saying no is fine — it just gives everyone time to plan.</li>
              </ul>

              <RenewalResponder token={token} respondBy={fmtDate(r.respond_by)} />
            </>
          )}

          <div className="rp-sig">
            Questions? Reply to the email, or write to{' '}
            {landlord.data?.email
              ? <a href={`mailto:${landlord.data.email}`}>{landlord.data.email}</a>
              : <a href="mailto:hello@homehive.live">hello@homehive.live</a>}.
          </div>
        </div>
      </div>

      <div className="rp-mark">HomeHive · built for ASU &amp; Tempe students</div>
    </main>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f8f9fa; }

  .rp { min-height: 100vh; background: #f8f9fa; font-family: 'DM Sans', -apple-system, sans-serif; padding: 28px 16px 48px; }
  .rp-card { max-width: 520px; margin: 0 auto; border-radius: 15px; overflow: hidden; box-shadow: 0 2px 18px rgba(15,23,42,0.07); }

  .rp-brand { background: #1a1a1a; padding: 18px 24px; font-size: 21px; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
  .rp-brand span { color: #FFC627; font-style: italic; }

  .rp-banner { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px 24px; }
  .rp-banner-k { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.9px; color: #92400e; }
  .rp-banner-v { font-size: 17px; font-weight: 700; color: #1a1a1a; margin-top: 3px; letter-spacing: -0.2px; }
  .rp-addr { font-size: 12.5px; color: #9b7a32; margin-top: 2px; }

  .rp-body { background: #fff; padding: 24px; }
  .rp-lede { font-size: 14.5px; color: #3a3a3a; line-height: 1.65; margin-bottom: 18px; }

  .rp-terms { background: #faf9f6; border: 1px solid #e8e4db; border-radius: 11px; padding: 4px 16px; margin-bottom: 18px; }
  .rp-terms > div { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; padding: 11px 0; }
  .rp-terms > div + div { border-top: 1px solid #f0ece4; }
  .rp-terms dt { font-size: 12.5px; color: #9b9b9b; flex-shrink: 0; }
  .rp-terms dd { font-size: 14px; color: #1a1a1a; font-weight: 600; text-align: right; }
  .rp-terms dd strong { font-size: 17px; }
  .rp-delta { display: block; font-size: 11.5px; font-weight: 600; color: #9b9b9b; margin-top: 2px; }
  .rp-delta.up { color: #9f1239; }
  .rp-delta.down { color: #047857; }
  .rp-delta.same { color: #047857; }

  .rp-msg { border-left: 3px solid #e8e4db; padding: 2px 0 2px 14px; margin-bottom: 18px; font-size: 13.5px; color: #3a3a3a; line-height: 1.65; font-style: italic; white-space: pre-wrap; }

  .rp-why { list-style: none; margin-bottom: 20px; }
  .rp-why li { font-size: 13px; color: #3a3a3a; line-height: 1.55; padding-left: 22px; position: relative; margin-bottom: 7px; }
  .rp-why li::before { content: '✓'; position: absolute; left: 0; top: -1px; width: 16px; height: 16px; border-radius: 50%; background: #16a34a; color: #fff; font-size: 9px; font-weight: 700; text-align: center; line-height: 16px; }

  .rp-closed { border-radius: 12px; padding: 20px; border: 1.5px solid; margin-bottom: 4px; }
  .rp-closed.yes { background: #f0fdf4; border-color: #86efac; }
  .rp-closed.no { background: #f8fafc; border-color: #e2e8f0; }
  .rp-closed-h { font-size: 17px; font-weight: 700; color: #1a1a1a; margin-bottom: 7px; letter-spacing: -0.2px; }
  .rp-closed p { font-size: 13.5px; color: #3a3a3a; line-height: 1.65; }

  .rp-sig { font-size: 12.5px; color: #9b9b9b; line-height: 1.6; margin-top: 20px; padding-top: 16px; border-top: 1px solid #f0ece4; }
  .rp-sig a { color: #8C1D40; }

  .rp-mark { text-align: center; font-size: 11.5px; color: #b8b8b8; margin-top: 18px; }
`
