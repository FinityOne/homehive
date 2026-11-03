'use client'

import {
  fmtLegalDate, fmtDollars, monthName,
  type AmendmentDocument, type AmendmentSignature,
} from '@/lib/leaseAmendments'

/**
 * The contract, on screen.
 *
 * One component for both sides. The landlord's copy and the tenant's copy of a
 * signed document must be the same document rendered the same way — two
 * renderers would eventually disagree about a clause, and the only place that
 * ever surfaces is an argument where it matters most.
 *
 * It renders `doc` and nothing else. No property lookup, no rent lookup, no
 * "current" anything: the document carries the premises, the party names and
 * the lease term it amends precisely so this component cannot accidentally
 * show a tenant a contract whose wording drifted after they signed it.
 *
 * Styled to read like a document rather than like an app — serif body, numbered
 * clauses, generous measure — because a tenant decides whether to take a lease
 * change seriously in the first second of looking at it, and a document that
 * looks like a settings page gets skimmed. It prints cleanly for the same
 * reason: the one thing people do with a signed lease document is keep a copy.
 */
export default function AmendmentDocumentView({
  doc,
  signature,
  /** Landlord's countersignature line. Their assent is the act of sending it. */
  showLandlordBlock = true,
}: {
  doc: AmendmentDocument
  signature?: AmendmentSignature | null
  showLandlordBlock?: boolean
}) {
  return (
    <article className="amdoc">
      <style>{CSS}</style>

      <header className="amdoc-hd">
        <h1 className="amdoc-title">{doc.title}</h1>
        <dl className="amdoc-meta">
          <div><dt>Premises</dt><dd>{doc.premises}</dd></div>
          <div><dt>Landlord</dt><dd>{doc.landlordName}</dd></div>
          <div><dt>Tenant</dt><dd>{doc.tenantName}</dd></div>
          <div>
            <dt>Lease being amended</dt>
            <dd>{fmtLegalDate(doc.leaseStartDate)} – {fmtLegalDate(doc.leaseEndDate)}</dd>
          </div>
          <div><dt>Effective</dt><dd>{fmtLegalDate(doc.effectiveDate)}</dd></div>
        </dl>
      </header>

      {/* The terms at a glance, above the contract itself.
          Not a substitute for reading it — the clauses are right there — but a
          student reading a legal document on a phone needs to know what it
          costs and when, before deciding to read four hundred words. Hiding
          that behind the prose is how people sign things they haven't
          understood. */}
      {doc.monthlyCharge > 0 && (
        <div className="amdoc-glance">
          <div className="g">
            <div className="g-k">{doc.monthlyChargeLabel || 'Monthly charge'}</div>
            <div className="g-v">{fmtDollars(doc.monthlyCharge)}<span className="g-per">/mo</span></div>
          </div>
          <div className="g">
            <div className="g-k">Starts with</div>
            <div className="g-v sm">{monthName(doc.effectiveDate)} rent</div>
          </div>
          <div className="g">
            <div className="g-k">Anything else to pay</div>
            <div className="g-v sm ok">Nothing</div>
          </div>
        </div>
      )}

      <section className="amdoc-recitals">
        {doc.recitals.map((r, i) => <p key={i}>{r}</p>)}
      </section>

      <ol className="amdoc-clauses">
        {doc.clauses.map((c, i) => (
          <li key={i}>
            <h2 className="amdoc-ch">{c.heading}</h2>
            {c.paragraphs.map((para, j) => <p key={j}>{para}</p>)}
          </li>
        ))}
      </ol>

      <section className="amdoc-sig">
        <h2 className="amdoc-ch">Signature</h2>
        <p className="amdoc-sigstate">{doc.signatureStatement}</p>

        <div className="amdoc-sigrow">
          <div className="amdoc-sigbox">
            <div className="amdoc-sigcap">Tenant</div>
            {signature ? (
              <>
                <div className="amdoc-signed">{signature.name}</div>
                <div className="amdoc-sigline" />
                <div className="amdoc-sigdate">
                  Signed electronically on {fmtLegalDate(signature.date)}
                </div>
              </>
            ) : (
              <>
                <div className="amdoc-signed empty">Not yet signed</div>
                <div className="amdoc-sigline" />
                <div className="amdoc-sigdate muted">{doc.tenantName}</div>
              </>
            )}
          </div>

          {showLandlordBlock && (
            <div className="amdoc-sigbox">
              <div className="amdoc-sigcap">Landlord</div>
              <div className="amdoc-signed">{doc.landlordName}</div>
              <div className="amdoc-sigline" />
              <div className="amdoc-sigdate">
                Issued {fmtLegalDate(doc.agreementDate)}
              </div>
            </div>
          )}
        </div>
      </section>
    </article>
  )
}

const CSS = `
.amdoc {
  background: #fff;
  border: 1px solid #e8e4db;
  border-radius: 14px;
  padding: 34px 32px 30px;
  color: #1f1d1a;
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  /* A measure, not a container width. Legal prose at 100 characters a line is
     prose nobody finishes. */
  max-width: 760px;
}
@media (max-width: 640px) { .amdoc { padding: 22px 18px 20px; border-radius: 12px; } }

.amdoc-hd { border-bottom: 2px solid #1f1d1a; padding-bottom: 18px; margin-bottom: 22px; }
.amdoc-title {
  margin: 0 0 16px; font-size: 21px; line-height: 1.3; font-weight: 700;
  letter-spacing: -0.2px; text-transform: uppercase;
}
.amdoc-meta { margin: 0; display: grid; gap: 7px; }
.amdoc-meta > div { display: grid; grid-template-columns: 170px 1fr; gap: 10px; }
@media (max-width: 560px) { .amdoc-meta > div { grid-template-columns: 1fr; gap: 1px; } }
.amdoc-meta dt {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.7px; color: #9b9b9b; padding-top: 2px;
}
.amdoc-meta dd { margin: 0; font-size: 14.5px; line-height: 1.5; font-weight: 600; }

.amdoc-glance {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
  background: #e8e4db; border: 1px solid #e8e4db; border-radius: 10px;
  overflow: hidden; margin-bottom: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
@media (max-width: 560px) { .amdoc-glance { grid-template-columns: 1fr; } }
.amdoc-glance .g { background: #faf9f6; padding: 13px 15px; }
.amdoc-glance .g-k {
  font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.7px; color: #9b9b9b; margin-bottom: 5px;
}
.amdoc-glance .g-v { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
.amdoc-glance .g-v.sm { font-size: 14px; font-weight: 700; letter-spacing: 0; }
.amdoc-glance .g-v.ok { color: #047857; }
.amdoc-glance .g-per { font-size: 12.5px; font-weight: 600; color: #9b9b9b; }

.amdoc-recitals p, .amdoc-clauses p, .amdoc-sigstate {
  margin: 0 0 12px; font-size: 14.5px; line-height: 1.72; color: #2c2a26;
}
.amdoc-recitals { margin-bottom: 8px; }
.amdoc-recitals p:first-child { font-weight: 600; }

.amdoc-clauses { margin: 0 0 8px; padding: 0 0 0 1.35em; }
.amdoc-clauses > li { margin-bottom: 20px; }
.amdoc-clauses > li::marker { font-weight: 700; font-size: 14px; color: #8C1D40; }
.amdoc-ch {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  margin: 0 0 9px; font-size: 12px; font-weight: 800; text-transform: uppercase;
  letter-spacing: 0.9px; color: #8C1D40;
}

.amdoc-sig { border-top: 1px solid #e8e4db; padding-top: 22px; margin-top: 10px; }
.amdoc-sigstate { font-size: 13px; color: #55524c; }
.amdoc-sigrow { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 22px; }
@media (max-width: 560px) { .amdoc-sigrow { grid-template-columns: 1fr; gap: 20px; } }
.amdoc-sigcap {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.8px; color: #9b9b9b; margin-bottom: 8px;
}
/* The signature itself, set in a script face so it reads as a signature and
   not as another form field. It is still just the typed name — the document's
   own statement says so — but a typed name rendered in body text does not look
   like an act, and people are entitled to feel that they signed something. */
.amdoc-signed {
  font-family: 'Snell Roundhand', 'Brush Script MT', 'Segoe Script', cursive;
  font-size: 29px; line-height: 1.15; color: #16324f; min-height: 36px;
  padding-left: 2px;
}
.amdoc-signed.empty {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px; color: #b9b4ab; font-style: italic; padding-top: 14px;
}
.amdoc-sigline { border-bottom: 1.5px solid #1f1d1a; margin: 4px 0 7px; }
.amdoc-sigdate {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px; color: #55524c;
}
.amdoc-sigdate.muted { color: #9b9b9b; }

@media print {
  .amdoc { border: none; border-radius: 0; padding: 0; max-width: none; }
  .amdoc-glance { break-inside: avoid; }
  .amdoc-clauses > li, .amdoc-sig { break-inside: avoid; }
}
`
