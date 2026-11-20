/**
 * The visual language of the tenant portal — defined once, imported by every
 * screen in it.
 *
 * Why this exists: the portal a renter actually lives in had grown three
 * unrelated languages, and the seam ran straight through its most important
 * screen. `/dashboard` spoke the logo's language — cream field, maroon
 * structure, gold accent, a Fraunces display face — and so did `/groups` and
 * `/dashboard/list`. But `/dashboard/lease`, the page where rent is paid, the
 * pay sheet, the late-fee sheet and the amendment signing page all spoke the
 * landlord admin's slate-and-emerald: `#0f172a` buttons with `#34d399` text,
 * 12px radii, no serif anywhere. A tenant pressing "My Lease & Rent" in a
 * maroon sidebar landed in a navy application, and the primary button changed
 * colour, shape and meaning mid-flow — at the exact moment we are asking them
 * for money. The page widths disagreed too (600px vs 780px), so the column
 * jumped as they navigated.
 *
 * Four rules hold everywhere below.
 *
 *   1. **Maroon means interactive.** `--primary` is the one action colour on a
 *      light surface, and nothing informational wears it. The portal chrome's
 *      active nav row is already maroon; a page whose buttons are a different
 *      hue from its own sidebar reads as two products bolted together.
 *
 *   2. **Gold only ever fills, and only on dark.** The accent is 1.6:1 on
 *      cream — it is not a text colour on a light band, ever (that is
 *      `--accent-text`, 5.6:1). It is the CTA fill *inside* a deep-maroon
 *      panel, with `--ink` on it, which is where the public site puts it and
 *      where it reads as the single most wanted press on the screen. One per
 *      surface, no exceptions.
 *
 *   3. **One colour, one meaning, and never the only signal.** `--owed` red is
 *      money behind, `--paid` green is money received, `--clearing` teal is a
 *      bank transfer in flight, `--fee` amber is a late fee or something
 *      needing attention, `--idle` grey is nothing to do. The in-flight teal
 *      is deliberately the landlord money area's `--flight` hue (one step
 *      darker, for contrast inside its own badge), because the two sides of a
 *      payment should not describe its state in different colours. Every state
 *      also carries a *word*, so the portal survives colour-blindness and a
 *      screenshot in a text message — and `npm run verify:tenant-contrast`
 *      computes every pairing below rather than trusting these comments.
 *
 *   4. **One figure leads.** A tenant opens this portal to answer one question
 *      — "do I owe anything, and by when" — so the balance is a display-size
 *      figure on a dark panel, not the first of four equal tiles. Supporting
 *      numbers are `.tp-stat`s and are deliberately quieter.
 *
 * Mechanically this mirrors `src/lib/financeTheme.ts`: a CSS string injected
 * once per page *before* that page's own sheet, scoped under a root `.tp`
 * class, so every tenant page root needs `className="tp …"`. Tokens are
 * declared on `.tp` rather than `:root` so the portal cannot leak into the
 * public site's `--hh-*` system or the landlord's `.fin` one.
 *
 * Accessibility is part of the theme, not a later pass: focus rings are
 * defined once on `:focus-visible`, every tap target in a sheet clears 44px on
 * a phone, and all motion is behind `prefers-reduced-motion`.
 */

/** Tokens plus the shared primitives. Inject once per page, before page CSS. */
export const TENANT_THEME = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,300&family=DM+Sans:wght@400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .tp {
    /* ── Ink. Warm, taken from the logo's own neutrals — a cold grey on a
       cream field reads as a different brand's page. ── */
    --ink:       #1F1517;
    --ink-2:     #40302F;
    --ink-3:     #6E5B59;
    --ink-4:     #8E7B79;
    --line:      #E3D9D5;
    --line-2:    #F2EBE7;

    /* ── Surfaces ── */
    --surface:   #ffffff;
    --surface-2: #FBF8F5;
    --page:      #FFF7F2;

    /* ── Interactive: the logo's hexagon. 6.6:1 against white, and white on
       it is the same figure, so it works as a fill and as a link colour. ── */
    --primary:      #8C1D40;
    --primary-ink:  #6E1733;
    --primary-tint: #F3DDE3;
    --primary-wash: #FBEEF2;

    /* ── Dark panels are deep maroon, never navy or slate. This is the one
       surface gold is allowed on. ── */
    --dark:      #4A0F22;
    --dark-2:    #671529;
    --on-dark:   rgba(255,255,255,0.92);
    --on-dark-2: rgba(255,255,255,0.62);
    --on-dark-3: rgba(255,255,255,0.40);
    --on-dark-line: rgba(255,255,255,0.14);

    /* ── Accent: the lit honeycomb cell. Fill on dark only. --accent-text is
       the same family at 5.6:1, for the rare small text on a light band. ── */
    --accent:      #FFC627;
    --accent-soft: #FFE48F;
    --accent-wash: #FFF3C4;
    --accent-text: #8A5A00;

    /* ── State. One meaning each; see rule 3. ── */
    --owed:       #B3261E;   /* behind on money */
    --owed-wash:  #FDECEA;
    --owed-line:  #F6CFCB;
    --paid:       #0F7A43;   /* money received, fee waived, job done */
    --paid-wash:  #E8F4ED;
    --paid-line:  #BFE3CE;
    /* ACH in flight. The landlord money area's --flight is #0D7F82, and this
       is the same teal one step darker: at #0D7F82 the word "Clearing" inside
       its own badge wash came to 4.22:1, which npm run verify:tenant-contrast
       fails. The hue is what carries the shared meaning across the two sides
       of a payment; the step keeps the badge readable, which is the whole
       point of having the word in it. (No backticks in here — this comment
       lives inside a template literal.) */
    --clearing:   #0C7275;
    --clearing-wash: #E6F3F3;
    --clearing-line: #B8DEDF;
    --fee:        #8A5A00;   /* late fee / needs attention */
    --fee-wash:   #FFF8E6;
    --fee-line:   #FFE4A3;
    --idle:       #8E7B79;   /* nothing to do */
    --idle-wash:  #F6F2EF;

    /* ── Form ── */
    --r-sm: 8px; --r: 12px; --r-lg: 16px; --r-xl: 22px;
    --shadow:    0 1px 2px rgba(74,15,34,0.04), 0 6px 18px rgba(74,15,34,0.05);
    --shadow-lg: 0 18px 50px rgba(74,15,34,0.18);
    --ring:      0 0 0 3px rgba(140,29,64,0.28);

    --sans: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --display: 'Fraunces', Georgia, serif;

    font-family: var(--sans);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }

  /* ── PAGE FRAME ───────────────────────────────────────────────────────────
     One column width for the whole portal. The dashboard was 600px and the
     lease page 780px, so the content shifted under the cursor on every
     navigation; 760px is the lease page's density at a width the dashboard's
     two-up grids still work in. 'tp-wrap wide' is for the few screens that
     genuinely hold a grid (groups, recommendations). ── */
  .tp-wrap { max-width: 760px; margin: 0 auto; padding: 26px 18px 96px; }
  .tp-wrap.narrow { max-width: 560px; }
  .tp-wrap.wide { max-width: 980px; }

  /* ── TYPE ──────────────────────────────────────────────────────────────── */
  .tp-h1 { font-family: var(--display); font-size: 30px; font-weight: 400;
    letter-spacing: -0.5px; line-height: 1.15; color: var(--ink); }
  .tp-h1 em { font-style: italic; font-weight: 300; }
  .tp-lede { font-size: 14px; color: var(--ink-3); line-height: 1.55; margin-top: 5px; }
  .tp-eyebrow { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: var(--ink-4); }
  .tp-h2 { font-size: 16px; font-weight: 600; letter-spacing: -0.2px; color: var(--ink); }
  .tp-muted { font-size: 13.5px; color: var(--ink-3); line-height: 1.6; }
  .tp-hint { font-size: 12px; color: var(--ink-4); line-height: 1.6; }
  /* A money figure. Tabular so a column of them lines up on the decimal. */
  .tp-money { font-variant-numeric: tabular-nums; }

  /* ── PAGE HEAD: title, one line of context, one primary action ── */
  .tp-head { display: flex; align-items: flex-end; justify-content: space-between;
    gap: 18px; flex-wrap: wrap; margin-bottom: 20px; }
  .tp-head-main { min-width: 0; }
  .tp-back { display: inline-flex; align-items: center; gap: 6px; font-size: 13px;
    font-weight: 500; color: var(--ink-3); text-decoration: none; margin-bottom: 14px; }
  .tp-back:hover { color: var(--primary); }

  /* ── SECTION HEAD ── */
  .tp-sec { display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; margin: 26px 0 10px; }
  .tp-sec:first-child { margin-top: 0; }
  .tp-sec-link { font-size: 12.5px; font-weight: 600; color: var(--primary);
    text-decoration: none; }
  .tp-sec-link:hover { text-decoration: underline; }

  /* ── BUTTONS ───────────────────────────────────────────────────────────────
     Three shapes, one meaning each. 44px tall on a phone — this is a surface
     people use one-handed, standing up, to pay rent. ── */
  .tp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    height: 40px; padding: 0 18px; border: none; border-radius: 10px;
    font-family: var(--sans); font-size: 13.5px; font-weight: 600; cursor: pointer;
    text-decoration: none; white-space: nowrap;
    transition: background-color .14s ease, border-color .14s ease, transform .1s ease; }
  .tp-btn:active { transform: translateY(1px); }
  .tp-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
  .tp-btn.lg { height: 48px; padding: 0 24px; font-size: 15px; border-radius: 12px; }
  .tp-btn.sm { height: 32px; padding: 0 13px; font-size: 12.5px; border-radius: 8px; }
  .tp-btn.full { width: 100%; }

  /* The one primary on a light surface. */
  .tp-btn-primary { background: var(--primary); color: #fff; }
  .tp-btn-primary:hover:not(:disabled) { background: var(--primary-ink); }
  /* A real alternative to the primary, not a second primary. */
  .tp-btn-secondary { background: var(--surface); color: var(--ink);
    border: 1.5px solid var(--line); }
  .tp-btn-secondary:hover:not(:disabled) { border-color: var(--ink-4); }
  /* Incidental. */
  .tp-btn-ghost { background: transparent; color: var(--primary); padding: 0 8px; }
  .tp-btn-ghost:hover:not(:disabled) { background: var(--primary-wash); }
  /* Gold, and only inside a dark panel. See rule 2. */
  .tp-btn-accent { background: var(--accent); color: var(--ink);
    box-shadow: 0 6px 18px rgba(255,198,39,0.22); }
  .tp-btn-accent:hover:not(:disabled) { background: var(--accent-soft); }

  /* ── CARDS ─────────────────────────────────────────────────────────────── */
  .tp-card { background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r); box-shadow: var(--shadow); margin-bottom: 14px; }
  .tp-card-hd { display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--line-2); }
  .tp-card-title { font-size: 13.5px; font-weight: 600; color: var(--ink);
    letter-spacing: -0.1px; }
  .tp-card-note { font-size: 13.5px; font-weight: 700; color: var(--ink);
    font-variant-numeric: tabular-nums; }
  .tp-card-note.owed { color: var(--owed); }
  .tp-card-note.paid { color: var(--paid); }
  .tp-card-note.fee  { color: var(--fee); }
  .tp-card-count { display: inline-flex; align-items: center; justify-content: center;
    min-width: 20px; height: 20px; padding: 0 6px; border-radius: 20px;
    background: var(--idle-wash); color: var(--ink-3);
    font-size: 11px; font-weight: 700; }
  .tp-card-bd { padding: 16px 18px; }
  .tp-card-ft { padding: 13px 18px; border-top: 1px solid var(--line-2);
    background: var(--surface-2); border-radius: 0 0 var(--r) var(--r); }
  /* A card whose subject is a fee, or a waiver. Tinted header only — the body
     stays white so the figures in it keep full contrast. */
  .tp-card.fee { border-color: var(--fee-line); }
  .tp-card.fee > .tp-card-hd { background: var(--fee-wash); }
  .tp-card.paid { border-color: var(--paid-line); }
  .tp-card.paid > .tp-card-hd { background: var(--paid-wash); }
  /* The card that is the tenant's to act on. */
  .tp-card.act { border: 1.5px solid var(--primary); box-shadow: var(--shadow); }

  /* ── DARK PANEL: the balance hero, and nothing else per screen ── */
  .tp-panel { position: relative; overflow: hidden; border-radius: var(--r-lg);
    background: linear-gradient(145deg, var(--dark) 0%, var(--dark-2) 100%);
    color: var(--on-dark); padding: 22px 24px; margin-bottom: 16px; }
  /* The lit cell from the mark, as a wash. Decorative, and behind everything. */
  .tp-panel::after { content: ''; position: absolute; top: -70px; right: -50px;
    width: 220px; height: 220px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,198,39,0.16), transparent 68%);
    pointer-events: none; }
  .tp-panel > * { position: relative; z-index: 1; }
  .tp-panel-eyebrow { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1.1px; color: var(--accent); }
  .tp-panel-fig { font-family: var(--display); font-size: 42px; font-weight: 600;
    letter-spacing: -1.5px; line-height: 1.05; color: #fff; margin-top: 8px;
    font-variant-numeric: tabular-nums; }
  .tp-panel-sub { font-size: 13.5px; color: var(--on-dark-2); line-height: 1.55;
    margin-top: 7px; }
  .tp-panel-sub strong { color: #fff; font-weight: 600; }
  .tp-panel-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 18px; }
  .tp-panel-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
    margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--on-dark-line); }
  .tp-panel-l { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .7px; color: var(--on-dark-3); }
  .tp-panel-v { font-size: 15px; font-weight: 600; color: #fff; margin-top: 4px;
    font-variant-numeric: tabular-nums; }
  /* On dark, a ghost button is an outline — never gold text. */
  .tp-panel .tp-btn-outline { background: rgba(255,255,255,0.08); color: #fff;
    border: 1px solid var(--on-dark-line); }
  .tp-panel .tp-btn-outline:hover { background: rgba(255,255,255,0.16); }

  /* ── STATS: supporting figures, deliberately quieter than the hero ── */
  .tp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
    margin-bottom: 18px; }
  .tp-stat { background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r); padding: 13px 15px; }
  .tp-stat-l { font-size: 10.5px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .6px; color: var(--ink-4); }
  .tp-stat-v { font-size: 16px; font-weight: 600; color: var(--ink); margin-top: 4px;
    font-variant-numeric: tabular-nums; letter-spacing: -0.2px; }
  .tp-stat-v.owed { color: var(--owed); }
  .tp-stat-v.paid { color: var(--paid); }
  .tp-stat-s { font-size: 11.5px; color: var(--ink-4); margin-top: 2px; }

  /* ── ROWS ──────────────────────────────────────────────────────────────── */
  .tp-row { display: flex; align-items: flex-start; justify-content: space-between;
    gap: 14px; padding: 11px 0; border-bottom: 1px solid var(--line-2);
    font-size: 13.5px; color: var(--ink-2); }
  .tp-row:last-child { border-bottom: none; padding-bottom: 0; }
  .tp-row:first-child { padding-top: 0; }
  .tp-row-amt { font-weight: 600; color: var(--ink); white-space: nowrap;
    text-align: right; font-variant-numeric: tabular-nums; }
  .tp-row.total { border-top: 1.5px solid var(--line); border-bottom: none;
    margin-top: 6px; padding-top: 12px; font-weight: 600; color: var(--ink); }
  /* The landlord's explanation of a charge, under the charge it explains. */
  .tp-row-note { display: block; margin-top: 4px; font-size: 12px; font-style: normal;
    color: var(--ink-3); line-height: 1.5; max-width: 48ch; }
  /* A row that opens something. The chevron is the affordance. */
  .tp-row-link { display: flex; align-items: center; justify-content: space-between;
    gap: 14px; width: 100%; background: none; border: none;
    border-bottom: 1px solid var(--line-2); padding: 12px 2px; margin: 0;
    font-family: var(--sans); text-align: left; cursor: pointer; color: var(--ink-2); }
  .tp-row-link:last-of-type { border-bottom: none; }
  .tp-row-link:hover { background: var(--surface-2); }
  .tp-chev { font-size: 18px; line-height: 1; color: var(--ink-4); flex-shrink: 0; }
  .tp-row-main { min-width: 0; }
  .tp-row-label { font-size: 13.5px; font-weight: 600; color: var(--ink); }
  .tp-row-sub { display: block; font-style: normal; font-size: 11.5px;
    color: var(--ink-4); margin-top: 3px; line-height: 1.45; }

  /* ── PICKABLE ROW: a charge the tenant can select to pay ── */
  .tp-pick { display: flex; align-items: center; gap: 12px; padding: 12px 0;
    border-bottom: 1px solid var(--line-2); font-size: 13.5px; color: var(--ink-2);
    cursor: pointer; }
  .tp-pick:last-child { border-bottom: none; }
  .tp-pick input[type="checkbox"] { width: 18px; height: 18px; flex-shrink: 0;
    accent-color: var(--primary); cursor: pointer; }
  .tp-pick.upcoming { color: var(--ink-4); }
  .tp-pick.upcoming .tp-row-amt { color: var(--ink-3); font-weight: 500; }

  /* ── BADGES. Every one carries a word as well as a tone. ── */
  .tp-badge { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
    padding: 3px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .4px; white-space: nowrap; }
  .tp-badge.owed     { background: var(--owed-wash);     color: var(--owed); }
  .tp-badge.paid     { background: var(--paid-wash);     color: var(--paid); }
  .tp-badge.clearing { background: var(--clearing-wash); color: var(--clearing); }
  .tp-badge.fee      { background: var(--fee-wash);      color: var(--fee); }
  .tp-badge.idle     { background: var(--idle-wash);     color: var(--ink-3); }
  .tp-badge.accent   { background: var(--primary-wash);  color: var(--primary); }
  .tp-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    background: currentColor; }

  /* ── NOTES & BANNERS ───────────────────────────────────────────────────── */
  .tp-note { border-radius: var(--r-sm); padding: 12px 15px; font-size: 13px;
    line-height: 1.6; margin-bottom: 14px; }
  .tp-note strong { font-weight: 600; }
  .tp-note.info  { background: var(--surface-2); border: 1px solid var(--line);
    color: var(--ink-2); }
  .tp-note.warn  { background: var(--fee-wash); border: 1px solid var(--fee-line);
    color: var(--fee); }
  .tp-note.bad   { background: var(--owed-wash); border: 1px solid var(--owed-line);
    color: var(--owed); }
  .tp-note.good  { background: var(--paid-wash); border: 1px solid var(--paid-line);
    color: var(--paid); }
  .tp-note.flight{ background: var(--clearing-wash); border: 1px solid var(--clearing-line);
    color: var(--clearing); }

  /* ── TABS. URL-backed on every screen that has them, so back works. ── */
  .tp-tabs { display: flex; gap: 4px; margin-bottom: 18px; overflow-x: auto;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
    border-bottom: 1px solid var(--line); }
  .tp-tabs::-webkit-scrollbar { display: none; }
  .tp-tab { position: relative; background: none; border: none; cursor: pointer;
    padding: 11px 14px 12px; font-family: var(--sans); font-size: 13.5px;
    font-weight: 500; color: var(--ink-3); white-space: nowrap;
    border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tp-tab:hover { color: var(--ink); }
  .tp-tab.on { color: var(--primary); font-weight: 600;
    border-bottom-color: var(--primary); }
  .tp-tab-badge { display: inline-flex; align-items: center; justify-content: center;
    min-width: 18px; height: 18px; padding: 0 5px; margin-left: 7px;
    border-radius: 20px; background: var(--primary); color: #fff;
    font-size: 10.5px; font-weight: 700; }
  .tp-tab.on .tp-tab-badge { background: var(--primary); }

  /* ── EMPTY STATE. Always names the one thing to do next. ── */
  .tp-empty { background: var(--surface); border: 1px dashed var(--line);
    border-radius: var(--r-lg); padding: 44px 28px; text-align: center; }
  .tp-empty-ic { width: 44px; height: 44px; margin: 0 auto 14px; border-radius: 13px;
    background: var(--primary-wash); color: var(--primary);
    display: flex; align-items: center; justify-content: center; }
  .tp-empty-t { font-family: var(--display); font-size: 19px; font-weight: 400;
    color: var(--ink); margin-bottom: 7px; letter-spacing: -0.2px; }
  .tp-empty-s { font-size: 13.5px; color: var(--ink-3); line-height: 1.6;
    max-width: 42ch; margin: 0 auto 20px; }

  /* ── SKELETONS ─────────────────────────────────────────────────────────────
     Every screen used to render the word "Loading..." centred in 60vh, which
     tells a tenant nothing about what is coming and makes a 400ms fetch feel
     like a stall. These hold the real layout. ── */
  .tp-sk { background: linear-gradient(90deg, var(--line-2) 25%, #FAF5F2 37%, var(--line-2) 63%);
    background-size: 400% 100%; border-radius: 7px;
    animation: tp-sheen 1.3s ease-in-out infinite; }
  @keyframes tp-sheen { 0% { background-position: 100% 0 } 100% { background-position: 0 0 } }
  .tp-sk-panel { height: 188px; border-radius: var(--r-lg); margin-bottom: 16px; }
  .tp-sk-card { height: 112px; border-radius: var(--r); margin-bottom: 14px; }
  .tp-sk-line { height: 13px; margin-bottom: 9px; }

  /* ── SHEET: one modal shape for the whole portal ───────────────────────────
     Centred dialog on a desktop, bottom sheet on a phone — a 460px card
     floating mid-screen is the wrong shape for a thumb. ── */
  .tp-sheet-back { position: fixed; inset: 0; z-index: 600;
    background: rgba(31,21,23,0.55); backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
    animation: tp-fade .16s ease; }
  .tp-sheet { display: flex; flex-direction: column; width: 100%; max-width: 470px;
    max-height: min(92vh, 780px); background: var(--surface);
    border-radius: var(--r-xl); box-shadow: var(--shadow-lg); overflow: hidden;
    animation: tp-rise .2s cubic-bezier(.2,.8,.2,1); }
  .tp-sheet.wide { max-width: 560px; }
  .tp-sheet-hd { display: flex; align-items: flex-start; justify-content: space-between;
    gap: 14px; padding: 18px 20px 15px; border-bottom: 1px solid var(--line-2); }
  .tp-sheet-k { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: var(--ink-4); }
  .tp-sheet-t { font-family: var(--display); font-size: 20px; font-weight: 400;
    color: var(--ink); letter-spacing: -0.3px; margin-top: 3px; }
  .tp-sheet-sub { font-size: 12.5px; color: var(--ink-4); margin-top: 3px; }
  .tp-sheet-x { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%;
    background: var(--surface-2); border: none; cursor: pointer;
    font-size: 19px; line-height: 1; color: var(--ink-3); }
  .tp-sheet-x:hover { background: var(--line-2); color: var(--ink); }
  .tp-sheet-bd { padding: 18px 20px 22px; overflow-y: auto;
    -webkit-overflow-scrolling: touch; }
  .tp-sheet-ft { display: flex; gap: 9px; padding: 14px 20px 18px;
    border-top: 1px solid var(--line-2); background: var(--surface); }
  .tp-sheet-ft .tp-btn { flex: 1; }
  @keyframes tp-fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes tp-rise { from { opacity: 0; transform: translateY(14px) scale(.985) }
                       to   { opacity: 1; transform: none } }

  /* ── FORMS ─────────────────────────────────────────────────────────────── */
  .tp-label { display: block; font-size: 12px; font-weight: 600; color: var(--ink-2);
    margin-bottom: 6px; }
  .tp-input, .tp-textarea { width: 100%; background: var(--surface);
    border: 1.5px solid var(--line); border-radius: var(--r-sm);
    padding: 11px 13px; font-family: var(--sans); font-size: 14px; color: var(--ink);
    outline: none; transition: border-color .14s ease; }
  .tp-textarea { resize: vertical; min-height: 96px; line-height: 1.6; }
  .tp-input:focus, .tp-textarea:focus { border-color: var(--primary); }
  .tp-input::placeholder, .tp-textarea::placeholder { color: var(--ink-4); }

  /* ── SELECTABLE OPTION (payment method, and anything else one-of-N) ── */
  .tp-option { display: block; width: 100%; text-align: left; cursor: pointer;
    background: var(--surface); border: 1.5px solid var(--line);
    border-radius: var(--r); padding: 13px 15px; font-family: var(--sans);
    transition: border-color .14s ease, background-color .14s ease; }
  .tp-option:hover { border-color: var(--ink-4); }
  .tp-option.on { border-color: var(--primary); border-width: 2px;
    padding: 12px 14px; background: var(--primary-wash); }

  /* ── FOCUS. Defined once, for everything. ── */
  .tp :focus-visible, .tp-sheet-back :focus-visible {
    outline: 2px solid var(--primary); outline-offset: 2px;
    border-radius: 4px; box-shadow: var(--ring); }

  /* ── MOBILE ────────────────────────────────────────────────────────────── */
  @media (max-width: 720px) {
    .tp-wrap { padding: 20px 15px 104px; }
    .tp-h1 { font-size: 25px; }
    .tp-panel { padding: 19px 18px; border-radius: var(--r); }
    .tp-panel-fig { font-size: 36px; }
    .tp-panel-grid { grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .tp-panel-v { font-size: 13.5px; }
    .tp-stats { grid-template-columns: repeat(2, 1fr); }
    .tp-head { align-items: flex-start; }
    /* A thumb-sized target on every action in the portal. */
    .tp-btn { height: 44px; }
    .tp-btn.sm { height: 36px; }
    .tp-btn.lg { height: 50px; }
    .tp-head .tp-btn, .tp-panel-actions .tp-btn { width: 100%; }
    .tp-panel-actions { flex-direction: column; }
    /* The sheet becomes a bottom sheet. */
    .tp-sheet-back { padding: 0; align-items: flex-end; }
    .tp-sheet { max-width: none; max-height: 93vh;
      border-radius: var(--r-xl) var(--r-xl) 0 0; animation: tp-slide .22s cubic-bezier(.2,.8,.2,1); }
    .tp-sheet-ft { flex-direction: column-reverse;
      padding-bottom: max(18px, env(safe-area-inset-bottom)); }
    @keyframes tp-slide { from { transform: translateY(100%) } to { transform: none } }
  }

  @media (prefers-reduced-motion: reduce) {
    .tp *, .tp-sheet-back *, .tp-sheet, .tp-sheet-back, .tp-sk {
      animation: none !important; transition: none !important; }
  }
`

/**
 * The tone a figure or a state should wear, from the one word that describes
 * it. Centralised so "clearing" cannot be teal on one screen and amber on the
 * next — which is exactly what happened when each page picked its own hex.
 */
export type TenantTone = 'owed' | 'paid' | 'clearing' | 'fee' | 'idle' | 'accent'

/** A settled charge's tone and the word that must accompany it. */
export function settlementTone(status: string): { tone: TenantTone; label: string } {
  if (status === 'processing') return { tone: 'clearing', label: 'Clearing' }
  if (status === 'paid') return { tone: 'paid', label: 'Paid' }
  if (status === 'voided') return { tone: 'idle', label: 'Cancelled' }
  return { tone: 'owed', label: 'Due' }
}
