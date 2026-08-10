import { computeTotals, explainLateFee, fmtMoney, type Inspection, type InspectionParty } from '@/lib/inspections'
import PrintButton from './PrintButton'

/**
 * The shareable, printable move-out report.
 *
 * Rendered on its own route with no app chrome so a landlord can print it or
 * send the link straight to tenants. Everything is inline/self-contained CSS —
 * print stylesheets and the app's global styles don't mix well.
 */

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function partyLabel(p: InspectionParty): string {
  return p.room_label ? `${p.name} · ${p.room_label}` : p.name
}

export default function InspectionReport({
  inspection,
  /**
   * When set, renders that one tenant's statement instead of the whole house:
   * only findings they're charged for (their own plus their share of common
   * ones), only their late fees, only their reconciliation. A departing
   * housemate has no business seeing everyone else's deposits and balances.
   */
  partyId,
}: {
  inspection: Inspection
  partyId?: string
}) {
  const totals = computeTotals(inspection)
  const isDraft = inspection.status !== 'finalized'

  const personal = partyId ? totals.perParty.find(p => p.party.id === partyId) ?? null : null
  const isPersonal = !!personal

  // A personal report shows the findings that cost this tenant money, plus
  // wear-and-tear items — documenting what was *not* charged is what makes the
  // charges that were applied credible.
  const chargedItemIds = new Set(personal?.charges.map(c => c.itemId) ?? [])
  const visibleItems = isPersonal
    ? inspection.items.filter(i => chargedItemIds.has(i.id) || i.is_wear_and_tear)
    : inspection.items

  const visibleParties = isPersonal && personal ? [personal.party] : inspection.parties
  const visibleTotals = isPersonal && personal ? [personal] : totals.perParty

  // Findings keep their entered order but group under their area heading.
  const areas: { area: string; items: typeof inspection.items }[] = []
  for (const item of visibleItems) {
    const area = item.area?.trim() || 'General'
    const bucket = areas.find(a => a.area === area)
    if (bucket) bucket.items.push(item)
    else areas.push({ area, items: [item] })
  }

  const chargedToLabel = (item: (typeof inspection.items)[number]): string => {
    if (item.is_wear_and_tear) return 'Normal wear & tear — not charged'

    // On a personal report, describe the split without naming housemates.
    if (isPersonal && personal) {
      const charge = personal.charges.find(c => c.itemId === item.id)
      if (!charge) return 'Not charged to you'
      return charge.basis === 'shared'
        ? `Shared cost of ${fmtMoney(item.cost)}, split ${charge.sharedWith} ways — your share ${fmtMoney(charge.amount)}`
        : `Charged to you in full`
    }

    if (item.allocation === 'tenants' || item.allocation === 'tenant') {
      const named = inspection.parties.filter(x => (item.party_ids ?? []).includes(x.id))
      if (named.length === 0) return 'Charged to a tenant who is no longer on this report'
      if (named.length === 1) return `Charged to ${named[0].name}`
      const names = named.map(p => p.name)
      const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      return `Split evenly between ${list} — ${fmtMoney(item.cost / named.length)} each`
    }
    if (item.allocation === 'lease') {
      const n = inspection.parties.filter(x => x.lease_id && x.lease_id === item.allocated_lease_id).length
      return n > 0 ? `Split across ${n} tenant${n !== 1 ? 's' : ''} on that lease` : 'Lease no longer on this report'
    }
    const n = inspection.parties.length
    return `Shared — split across all ${n} tenant${n !== 1 ? 's' : ''}`
  }

  return (
    <div className="rep">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f1f5f9; }

        .rep { max-width: 860px; margin: 0 auto; padding: 28px 20px 80px; font-family: 'DM Sans', system-ui, sans-serif; color: #0f172a; }
        .sheet { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 44px 46px; }

        .toolbar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }

        .draft { background: #fffbeb; border: 1.5px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 9px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #92400e; line-height: 1.5; }
        .revised { background: #eff6ff; border: 1.5px solid #bfdbfe; border-left: 4px solid #3b82f6; border-radius: 9px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #1e40af; line-height: 1.55; }

        .hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 2px solid #0f172a; padding-bottom: 18px; margin-bottom: 22px; }
        .brand { font-size: 17px; font-weight: 700; letter-spacing: -0.3px; }
        .brand em { font-style: italic; color: #b8860b; }
        .doc-type { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #64748b; margin-top: 4px; }
        .prop-name { font-size: 22px; font-weight: 700; letter-spacing: -0.4px; }
        .prop-addr { font-size: 13px; color: #64748b; margin-top: 2px; }
        .hdr-right { text-align: right; font-size: 12px; color: #64748b; line-height: 1.7; white-space: nowrap; }

        .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 26px; }
        .meta-item { border-left: 2px solid #e2e8f0; padding-left: 11px; }
        .meta-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 3px; }
        .meta-val { font-size: 13px; font-weight: 500; }

        .sec { margin-bottom: 30px; }
        .sec-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.9px; color: #0f172a; padding-bottom: 7px; border-bottom: 1px solid #e2e8f0; margin-bottom: 14px; }

        .summary { font-size: 13.5px; line-height: 1.7; color: #334155; white-space: pre-wrap; }

        .party-line { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        .party-line:last-child { border-bottom: none; }
        .party-sub { font-size: 11.5px; color: #94a3b8; }

        .area-hd { font-size: 12px; font-weight: 700; color: #475569; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 7px; padding: 6px 11px; margin: 16px 0 10px; }
        .area-hd:first-of-type { margin-top: 0; }

        .find { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid #f1f5f9; page-break-inside: avoid; }
        .find-main { flex: 1; min-width: 0; }
        .find-title { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
        .find-desc { font-size: 12.5px; color: #475569; line-height: 1.6; }
        .find-notes { font-size: 11.5px; color: #94a3b8; line-height: 1.55; margin-top: 4px; font-style: italic; }
        .find-charge { font-size: 11px; font-weight: 600; color: #64748b; margin-top: 6px; }
        .find-cost { text-align: right; font-size: 14px; font-weight: 700; white-space: nowrap; min-width: 92px; }
        .find-cost.wear { color: #94a3b8; font-weight: 500; font-size: 12px; }

        .photos { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
        .photo { width: 118px; }
        .photo img { width: 118px; height: 88px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; display: block; }
        .photo-cap { font-size: 10px; color: #94a3b8; margin-top: 3px; line-height: 1.3; }

        table.recon { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.recon th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; padding: 0 0 8px; border-bottom: 1px solid #e2e8f0; }
        table.recon th.num, table.recon td.num { text-align: right; }
        table.recon td { padding: 11px 0; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
        .recon-name { font-weight: 600; }
        .recon-detail { font-size: 11.5px; color: #94a3b8; line-height: 1.6; margin-top: 3px; }
        .bal-pos { color: #059669; font-weight: 700; }
        .bal-neg { color: #dc2626; font-weight: 700; }

        .totals { margin-top: 18px; border-top: 2px solid #0f172a; padding-top: 14px; display: flex; justify-content: flex-end; }
        .totals-inner { width: 320px; }
        .tot-row { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; }
        .tot-row.grand { font-size: 15px; font-weight: 700; border-top: 1px solid #e2e8f0; margin-top: 6px; padding-top: 10px; }

        .lf-intro { font-size: 12.5px; color: #64748b; line-height: 1.6; margin-bottom: 14px; }
        .lf-block { margin-bottom: 18px; page-break-inside: avoid; }
        .lf-name { display: flex; justify-content: space-between; align-items: baseline; font-size: 13.5px; font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 4px; }
        .lf-sum { font-size: 14px; }
        table.lf-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        table.lf-table th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; padding: 6px 0; }
        table.lf-table th.num, table.lf-table td.num { text-align: right; white-space: nowrap; padding-left: 12px; }
        table.lf-table td { padding: 8px 0; border-top: 1px solid #f1f5f9; vertical-align: top; }
        .lf-label { font-weight: 600; color: #0f172a; }
        .lf-why { font-size: 11px; color: #94a3b8; line-height: 1.55; margin-top: 2px; }

        .foot { margin-top: 34px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11.5px; color: #94a3b8; line-height: 1.7; }

        .empty { font-size: 13px; color: #94a3b8; font-style: italic; }

        @media print {
          body { background: #fff; }
          .rep { padding: 0; max-width: none; }
          .sheet { border: none; border-radius: 0; padding: 0; }
          .toolbar { display: none; }
          .sec { page-break-inside: auto; }
          .area-hd { page-break-after: avoid; }
        }
        @media (max-width: 700px) {
          .sheet { padding: 26px 20px; }
          .meta { grid-template-columns: repeat(2, 1fr); }
          .hdr { flex-direction: column; }
          .hdr-right { text-align: left; }
        }
      `}</style>

      <div className="toolbar"><PrintButton /></div>

      <div className="sheet">
        {isDraft && (
          <div className="draft">
            <strong>Draft — not yet issued.</strong> Figures may still change. Finalize the
            inspection in your dashboard before sharing this with tenants.
          </div>
        )}

        {/* A revision replaces something the tenant already has — say so plainly. */}
        {!isDraft && (inspection.version ?? 0) > 1 && (
          <div className="revised">
            <strong>Revised statement — version {inspection.version}.</strong> This supersedes
            version {inspection.version - 1}
            {inspection.finalized_at
              ? `, issued ${new Date(inspection.finalized_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
              : ''}.
            {inspection.revision_note ? ` What changed: ${inspection.revision_note}` : ''}
          </div>
        )}

        <div className="hdr">
          <div>
            <div className="brand">Home<em>Hive</em></div>
            <div className="doc-type">
              {isPersonal ? 'Move-out Statement' : 'Move-out Inspection & Deposit Reconciliation'}
            </div>
            <div className="prop-name" style={{ marginTop: '12px' }}>
              {inspection.property?.name ?? 'Property'}
            </div>
            {inspection.property?.address && <div className="prop-addr">{inspection.property.address}</div>}
          </div>
          <div className="hdr-right">
            <div>Report #{inspection.id.slice(0, 8).toUpperCase()}</div>
            {(inspection.version ?? 0) > 0 && <div>Version {inspection.version}</div>}
            <div>Inspected {fmtDate(inspection.inspection_date)}</div>
            {inspection.finalized_at && (
              <div>Issued {new Date(inspection.finalized_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
            )}
          </div>
        </div>

        <div className="meta">
          <div className="meta-item">
            <div className="meta-label">Occupancy from</div>
            <div className="meta-val">{fmtDate(inspection.period_start)}</div>
          </div>
          <div className="meta-item">
            <div className="meta-label">Occupancy to</div>
            <div className="meta-val">{fmtDate(inspection.period_end)}</div>
          </div>
          <div className="meta-item">
            <div className="meta-label">Inspected by</div>
            <div className="meta-val">{inspection.inspected_by || '—'}</div>
          </div>
          <div className="meta-item">
            <div className="meta-label">Tenant present</div>
            <div className="meta-val">{inspection.tenant_present ? 'Yes' : 'No'}</div>
          </div>
        </div>

        {inspection.summary && (
          <div className="sec">
            <div className="sec-title">Summary</div>
            <div className="summary">{inspection.summary}</div>
          </div>
        )}

        <div className="sec">
          <div className="sec-title">{isPersonal ? 'Prepared for' : 'Tenants covered by this report'}</div>
          {visibleParties.length === 0 ? (
            <div className="empty">No tenants added.</div>
          ) : visibleParties.map(p => (
            <div key={p.id} className="party-line">
              <div>
                <div style={{ fontWeight: 600 }}>{partyLabel(p)}</div>
                {p.email && <div className="party-sub">{p.email}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="party-sub">Deposit held</div>
                <div style={{ fontWeight: 600 }}>{fmtMoney(p.deposit_held)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="sec">
          <div className="sec-title">
            {isPersonal ? `Findings that affect you (${visibleItems.length})` : `Findings (${visibleItems.length})`}
          </div>
          {visibleItems.length === 0 ? (
            <div className="empty">
              {isPersonal
                ? 'No findings were charged to you.'
                : 'No findings recorded — the property was returned in expected condition.'}
            </div>
          ) : areas.map(group => (
            <div key={group.area}>
              <div className="area-hd">{group.area}</div>
              {group.items.map(item => (
                <div key={item.id} className="find">
                  <div className="find-main">
                    <div className="find-title">{item.title}</div>
                    {item.description && <div className="find-desc">{item.description}</div>}
                    {item.notes && <div className="find-notes">{item.notes}</div>}
                    <div className="find-charge">{chargedToLabel(item)}</div>
                    {item.photos.length > 0 && (
                      <div className="photos">
                        {item.photos.map(ph => (
                          <div key={ph.id} className="photo">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ph.url} alt={ph.caption || item.title} />
                            {ph.caption && <div className="photo-cap">{ph.caption}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={`find-cost${item.is_wear_and_tear ? ' wear' : ''}`}>
                    {item.is_wear_and_tear ? 'No charge' : (() => {
                      const charge = isPersonal && personal
                        ? personal.charges.find(c => c.itemId === item.id)
                        : null
                      // Personal report bills the tenant's share, not the full cost.
                      return charge ? fmtMoney(charge.amount) : fmtMoney(item.cost)
                    })()}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {visibleTotals.some(pt => pt.lateFeesTotal > 0) && (
          <div className="sec">
            <div className="sec-title">Late payment charges</div>
            <div className="lf-intro">
              Rent payments that arrived after their due date. Each charge shows how it was
              calculated from the payment terms in your lease.
            </div>
            {visibleTotals.filter(pt => pt.lateFees.some(f => f.included)).map(pt => (
              <div key={pt.party.id} className="lf-block">
                <div className="lf-name">
                  {isPersonal ? 'Your late payments' : partyLabel(pt.party)}
                  <span className="lf-sum">{fmtMoney(pt.lateFeesTotal)}</span>
                </div>
                <table className="lf-table">
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th className="num">Days late</th>
                      <th className="num">Charge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pt.lateFees.filter(f => f.included).map(f => (
                      <tr key={f.id}>
                        <td>
                          <div className="lf-label">{f.label}</div>
                          <div className="lf-why">{explainLateFee(f)}</div>
                        </td>
                        <td className="num">{f.days_late}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmtMoney(f.fee_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        <div className="sec">
          <div className="sec-title">{isPersonal ? 'Your deposit' : 'Deposit reconciliation'}</div>
          {visibleTotals.length === 0 ? (
            <div className="empty">No tenants to reconcile.</div>
          ) : (
            <table className="recon">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th className="num">Charges</th>
                  <th className="num">Deposit held</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {visibleTotals.map(pt => (
                  <tr key={pt.party.id}>
                    <td>
                      <div className="recon-name">{partyLabel(pt.party)}</div>
                      {pt.charges.length > 0 && (
                        <div className="recon-detail">
                          {pt.charges.map(c => (
                            <div key={c.itemId}>
                              {c.title} — {fmtMoney(c.amount)}
                              {c.basis === 'shared' && ` (1/${c.sharedWith} share)`}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {fmtMoney(pt.total)}
                      {(() => {
                        const parts = [
                          pt.directTotal > 0 ? `${fmtMoney(pt.directTotal)} own` : null,
                          pt.sharedTotal > 0 ? `${fmtMoney(pt.sharedTotal)} shared` : null,
                          pt.lateFeesTotal > 0 ? `${fmtMoney(pt.lateFeesTotal)} late fees` : null,
                        ].filter(Boolean)
                        return parts.length > 1 ? <div className="recon-detail">{parts.join(' · ')}</div> : null
                      })()}
                    </td>
                    <td className="num">{fmtMoney(pt.depositHeld)}</td>
                    <td className="num">
                      <span className={pt.balance >= 0 ? 'bal-pos' : 'bal-neg'}>
                        {pt.balance >= 0 ? `${fmtMoney(pt.balance)} refund` : `${fmtMoney(Math.abs(pt.balance))} owed`}
                      </span>
                      {/* Once the money has moved, the tenant's copy says so. */}
                      {pt.party.settlement_status !== 'pending' && (
                        <div className="recon-detail">
                          {pt.party.settlement_status === 'returned' ? 'Returned' : 'Collected'}
                          {pt.party.settled_amount != null && ` ${fmtMoney(pt.party.settled_amount)}`}
                          {pt.party.settled_on && ` · ${fmtDate(pt.party.settled_on)}`}
                          {pt.party.settlement_method && ` · ${pt.party.settlement_method}`}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="totals">
            <div className="totals-inner">
              {isPersonal && personal ? (
                <>
                  <div className="tot-row">
                    <span>Security deposit held</span>
                    <span>{fmtMoney(personal.depositHeld)}</span>
                  </div>
                  {personal.directTotal > 0 && (
                    <div className="tot-row">
                      <span>Damage charged to you</span>
                      <span>− {fmtMoney(personal.directTotal)}</span>
                    </div>
                  )}
                  {personal.sharedTotal > 0 && (
                    <div className="tot-row">
                      <span>Your share of shared damage</span>
                      <span>− {fmtMoney(personal.sharedTotal)}</span>
                    </div>
                  )}
                  {personal.lateFeesTotal > 0 && (
                    <div className="tot-row">
                      <span>Late payment charges</span>
                      <span>− {fmtMoney(personal.lateFeesTotal)}</span>
                    </div>
                  )}
                  <div className="tot-row grand">
                    <span>{personal.balance >= 0 ? 'Refund due to you' : 'Balance due from you'}</span>
                    <span style={{ color: personal.balance >= 0 ? '#059669' : '#dc2626' }}>
                      {fmtMoney(Math.abs(personal.balance))}
                    </span>
                  </div>
                </>
              ) : (
                <>
              <div className="tot-row">
                <span>Chargeable damages</span>
                <span>{fmtMoney(totals.damageTotal)}</span>
              </div>
              {totals.lateFeeTotal > 0 && (
                <div className="tot-row">
                  <span>Late payment charges</span>
                  <span>{fmtMoney(totals.lateFeeTotal)}</span>
                </div>
              )}
              {totals.wearAndTear > 0 && (
                <div className="tot-row" style={{ color: '#94a3b8' }}>
                  <span>Wear &amp; tear (not charged)</span>
                  <span>{fmtMoney(totals.wearAndTear)}</span>
                </div>
              )}
              <div className="tot-row">
                <span>Total deposits held</span>
                <span>{fmtMoney(totals.totalDeposits)}</span>
              </div>
              <div className="tot-row grand">
                <span>Total refundable</span>
                <span style={{ color: '#059669' }}>{fmtMoney(totals.totalRefunds)}</span>
              </div>
              {totals.totalOwed > 0 && (
                <div className="tot-row grand" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
                  <span>Total still owed</span>
                  <span style={{ color: '#dc2626' }}>{fmtMoney(totals.totalOwed)}</span>
                </div>
              )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="foot">
          {inspection.response_due_date && (
            <div style={{ marginBottom: '6px' }}>
              Deposit balances are due to be settled by <strong>{fmtDate(inspection.response_due_date)}</strong>.
            </div>
          )}
          Charges reflect the cost to return the property to its move-in condition, excluding normal
          wear and tear. If you disagree with any item, reply to your landlord in writing with the
          report number above. Generated by HomeHive.
        </div>
      </div>
    </div>
  )
}
