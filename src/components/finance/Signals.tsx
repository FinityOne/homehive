'use client'

/**
 * The judgement panel — what the numbers mean, with the evidence folded under.
 *
 * Each row is a claim. Open it and you get the specific leases, people and
 * figures that make the claim true, plus the one place to go and act on it.
 * That order matters: a landlord will believe the second signal this product
 * ever shows them only if the first one showed its working.
 *
 * Collapsed by default, because five open signals is the wall this redesign
 * was escaping — except the most severe one, which opens itself. If something
 * is costing money right now, making the landlord click to find out what is a
 * tax on the only row that mattered.
 */

import { useState } from 'react'
import Link from 'next/link'
import Glyph from '@/components/finance/Glyph'
import type { Signal, Severity } from '@/lib/financialsSignals'

const TAG: Record<Severity, string> = {
  critical: 'Act now',
  warning:  'Needs attention',
  watch:    'Worth knowing',
  good:     'Healthy',
}

export default function Signals({ signals }: { signals: Signal[] }) {
  // The worst row opens itself; everything else waits to be asked.
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = signals[0]
    return new Set(first && first.severity === 'critical' ? [first.id] : [])
  })

  if (signals.length === 0) return null

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const acting = signals.filter(s => s.severity === 'critical' || s.severity === 'warning').length

  return (
    <section className="card">
      <div className="card-hd">
        <div>
          <h2 className="card-title">What this means</h2>
          <p className="muted sm">
            {acting > 0
              ? `${acting} thing${acting !== 1 ? 's' : ''} worth doing something about, worst first.`
              : 'Read in the order a manager would work them.'}
          </p>
        </div>
        <span className="card-note">{signals.length} signal{signals.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="sigs">
        {signals.map(s => {
          const isOpen = open.has(s.id)
          return (
            <div key={s.id} className="sig">
              <button
                className="sig-row"
                onClick={() => toggle(s.id)}
                aria-expanded={isOpen}
              >
                <span className={`gl-plate ${s.severity}`}>
                  <Glyph name={s.icon} size={15} />
                </span>
                <span className="sig-main">
                  <span className="sig-title">
                    {s.title}
                    <span className={`sig-tag ${s.severity}`}>{TAG[s.severity]}</span>
                  </span>
                  <span className="sig-detail">{s.detail}</span>
                </span>
                <span className={`twist sig-twist${isOpen ? ' open' : ''}`} aria-hidden="true" />
              </button>

              {isOpen && (
                <div className="sig-body">
                  {s.evidence.length > 0 && (
                    <ul className="sig-ev">
                      {s.evidence.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                  <Link className="btn-secondary sm" href={s.action.href}>
                    {s.action.label}
                    <Glyph name="arrow-right" size={14} />
                  </Link>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
