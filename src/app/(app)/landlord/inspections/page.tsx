'use client'

import { useEffect, useState } from 'react'
import { getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { getInspectionsForOwner, computeTotals, fmtMoney, type Inspection } from '@/lib/inspections'

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function InspectionsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { document.title = 'Checkout Inspections — Landlord | HomeHive' }, [])

  useEffect(() => {
    async function load() {
      const user = await getCurrentUser()
      if (!user) { router.push('/login'); return }
      setRows(await getInspectionsForOwner(user.id))
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading…
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .iw { max-width: 900px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .ih { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
        .it { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
        .isub { font-size: 13px; color: #64748b; margin-bottom: 24px; line-height: 1.55; }
        .ilink { color: #10b981; text-decoration: none; font-size: 13px; font-weight: 600; }
        .ilink:hover { text-decoration: underline; }
        .row { display: block; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 11px; padding: 15px 17px; margin-bottom: 10px; text-decoration: none; color: inherit; }
        .row:hover { border-color: #cbd5e1; }
        .rt { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .rname { font-size: 15px; font-weight: 600; color: #0f172a; }
        .rmeta { font-size: 12px; color: #94a3b8; margin-top: 3px; }
        .pill { font-size: 10px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
        .pill-draft { background: #fef3c7; color: #92400e; }
        .pill-final { background: #dbeafe; color: #1e40af; }
        .pill-settled { background: #d1fae5; color: #065f46; }
        .rfig { text-align: right; white-space: nowrap; }
        .rfig-val { font-size: 15px; font-weight: 700; color: #0f172a; }
        .rfig-lbl { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .empty { background: #fff; border: 1.5px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 12px; padding: 32px; }
        .eh { font-size: 17px; font-weight: 600; color: #0f172a; margin-bottom: 7px; }
        .es { font-size: 13.5px; color: #64748b; line-height: 1.6; }
      `}</style>

      <div className="iw">
        <div className="ih">
          <h1 className="it">Checkout Inspections</h1>
          <a href="/landlord/leases" className="ilink">Go to Leases →</a>
        </div>
        <div className="isub">
          Move-out reports covering one or more leases on a property. Start one from any lease.
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <div className="eh">No inspections yet</div>
            <div className="es">
              When a tenancy ends, open the lease and choose <strong>Start checkout inspection</strong>.
              You can link every lease in the house to one report, log findings with photos and costs,
              charge each to the right tenant, and share a printable deposit reconciliation.
            </div>
          </div>
        ) : rows.map(i => {
          const t = computeTotals(i)
          return (
            <a key={i.id} href={`/landlord/inspections/${i.id}`} className="row">
              <div className="rt">
                <div>
                  <div className="rname">{i.title || i.property?.name || 'Move-out inspection'}</div>
                  <div className="rmeta">
                    {i.property?.name} · {fmt(i.period_start)} → {fmt(i.period_end)} ·{' '}
                    {i.parties.length} tenant{i.parties.length !== 1 ? 's' : ''} ·{' '}
                    {i.items.length} finding{i.items.length !== 1 ? 's' : ''}
                    {i.status !== 'draft' && t.outstandingCount > 0 &&
                      ` · ${t.outstandingCount} deposit${t.outstandingCount !== 1 ? 's' : ''} pending return`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <span className={`pill ${
                    i.status === 'settled' ? 'pill-settled' : i.status === 'finalized' ? 'pill-final' : 'pill-draft'
                  }`}>
                    {i.status === 'settled' ? 'Settled' : i.status === 'finalized' ? 'Awaiting refunds' : 'Draft'}
                  </span>
                  <div className="rfig">
                    {/* What the landlord still has to do beats a static total. */}
                    <div className="rfig-val" style={{ color: t.outstandingRefunds > 0 ? '#059669' : '#0f172a' }}>
                      {t.outstandingRefunds > 0 ? fmtMoney(t.outstandingRefunds) : fmtMoney(t.chargeable)}
                    </div>
                    <div className="rfig-lbl">
                      {t.outstandingRefunds > 0 ? 'To refund' : 'Charges'}
                    </div>
                  </div>
                </div>
              </div>
            </a>
          )
        })}
      </div>
    </>
  )
}
