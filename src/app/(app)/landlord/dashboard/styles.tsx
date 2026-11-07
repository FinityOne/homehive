'use client'

/**
 * One stylesheet for the overview and the pages that hang off it.
 *
 * It used to live inline in the overview, which was fine while the overview
 * was the only screen that owned these classes — but `ListingPulse` and the
 * portfolio charts have always drawn themselves with `.panel`, `.row-item`
 * and `.prog-bar`, so moving either of them onto its own route would have
 * silently unstyled it. Both now import this.
 *
 * The container is deliberately wide. A landlord reads this screen on a
 * laptop, and a 960px column on a 1680px display spent two thirds of the
 * width on margin and paid for it in scrolling — which is the whole point of
 * the change: the overview answers "what needs me today" and an answer you
 * have to scroll for is an answer you missed.
 */
export default function DashStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600;700&display=swap');

      .db { max-width: 1560px; margin: 0 auto; padding: 24px 28px 56px; font-family: 'DM Sans', sans-serif; }

      .db-greeting { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 300; color: #0f172a; letter-spacing: -0.5px; line-height: 1.2; }
      .db-sub      { font-size: 13px; color: #94a3b8; margin-top: 3px; }

      /* Header: title on the left, scope + the doors to the deeper pages on
         the right, on one line. Stacking them cost 70px of the fold. */
      .db-hd { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
      .db-hd-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

      .db-prop-toggle { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; max-width: 100%; }
      .db-prop-pill { white-space: nowrap; flex-shrink: 0; padding: 5px 12px; border-radius: 100px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; border: 1px solid #e2e8f0; background: #fff; color: #475569; transition: background 0.15s, color 0.15s, border-color 0.15s; }
      .db-prop-pill:hover { border-color: #8C1D40; color: #8C1D40; }
      .db-prop-pill.is-active { background: #8C1D40; border-color: #8C1D40; color: #fff; }

      /* A door to a sub-page. Reads as a control, not as a sentence. */
      .db-jump { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; font-size: 12.5px; font-weight: 600; color: #334155; text-decoration: none; white-space: nowrap; }
      .db-jump:hover { border-color: #8C1D40; color: #8C1D40; }

      .db-section-title { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 300; color: #0f172a; letter-spacing: -0.3px; margin: 4px 0 14px; }
      .db-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
      .db-row-full { margin-bottom: 20px; }

      .stat-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 13px 15px; }
      .stat-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 7px; }
      .stat-num   { font-family: 'Fraunces', serif; font-size: 25px; font-weight: 300; color: #0f172a; letter-spacing: -1px; line-height: 1; }
      .stat-sub   { font-size: 11px; color: #94a3b8; margin-top: 5px; line-height: 1.4; }

      .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; min-width: 0; }
      .panel-hd { padding: 12px 16px 10px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-shrink: 0; }
      .panel-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.7px; }
      .panel-link  { font-size: 12px; color: #8C1D40; font-weight: 500; text-decoration: none; white-space: nowrap; }
      .panel-link:hover { text-decoration: underline; }
      .panel-body  { padding: 13px 16px; min-width: 0; }
      /* A panel that lives in a fixed-height band scrolls its own list rather
         than pushing the band taller — that is what keeps the fold honest. */
      .panel-scroll { flex: 1; overflow-y: auto; min-height: 0; }
      .panel-foot { padding: 9px 16px; border-top: 1px solid #f1f5f9; flex-shrink: 0; }

      .row-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f8fafc; gap: 8px; }
      .row-item:last-child { border-bottom: none; }
      .row-item-first { padding-top: 0; }

      .pill { display: inline-flex; align-items: center; border-radius: 20px; padding: 2px 9px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }

      .funnel { display: flex; gap: 6px; flex-wrap: wrap; }
      .funnel-seg { flex: 1; min-width: 56px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px 6px; text-align: center; }
      .funnel-n  { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 300; color: #0f172a; line-height: 1; }
      .funnel-lbl { font-size: 9.5px; color: #94a3b8; margin-top: 3px; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase; }

      .prog-bar { height: 6px; background: #f1f5f9; border-radius: 99px; overflow: hidden; margin-top: 4px; }
      .prog-fill { height: 100%; border-radius: 99px; transition: width 0.4s; }

      .badge-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

      .pending-banner { background: linear-gradient(135deg,#fffbeb,#fefce8); border: 1.5px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 12px; padding: 12px 16px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }

      @media (max-width: 1100px) { .db { padding: 20px 18px 56px; } }
      @media (max-width: 720px) {
        .db-row { grid-template-columns: 1fr; }
      }
    `}</style>
  )
}
