/**
 * The visual language of the money area — defined once, imported by every page
 * in it.
 *
 * Why this exists: the landlord's money screens had grown two unrelated
 * languages. The Financials page spoke in `#1d1d1f` ink with a `#0071e3` pill
 * action; the lease ledger rendered *inside* it spoke in near-black `#0f172a`
 * buttons with 7px corners and slate borders — and between them they used five
 * different greens for "paid" and four reds for "late". A landlord drilling from
 * a property into a lease watched the primary button change colour and shape
 * mid-flow, which reads as a different application, and made the one question
 * that matters ("what do I press?") harder than it needs to be.
 *
 * Three rules hold everywhere below:
 *
 *   1. **Blue means interactive.** Nothing informational is blue, ever. If it
 *      is accent-coloured, it can be clicked. In-flight money went teal for
 *      exactly this reason — it used to be blue, and so looked like a button.
 *   2. **One colour, one meaning.** Green is money received. Red is late or
 *      failed. Amber is a fee or something needing attention. Teal is in
 *      flight. Grey is "nothing to do". A figure never changes colour because
 *      it moved to a different screen.
 *   3. **One primary action per surface.** `.btn-primary` is the thing we want
 *      pressed; everything else is `.btn-secondary` (a real alternative) or
 *      `.btn-ghost` (incidental). Destructive actions are `.btn-danger` and are
 *      never the loudest thing on screen.
 *
 * Colour is never the only signal: every state badge carries a word as well as
 * a tone, which is what makes the palette legible to a colour-blind landlord
 * and in a screenshot pasted into a text message.
 */

/** Tokens plus the shared primitives. Inject once per page, before page CSS. */
export const FINANCE_THEME = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .fin {
    /* Ink */
    --ink:      #1d1d1f;
    --ink-2:    #6e6e73;
    --ink-3:    #8e8e93;
    --line:     #e5e5ea;
    --line-2:   #f0f0f2;
    --surface:  #ffffff;
    --surface-2:#fafafb;

    /* Interactive — and nothing else */
    --accent:     #0071e3;
    --accent-ink: #005bb8;
    --accent-bg:  #e8f1fd;

    /* State. Each one has a strong form for text and a soft form for fills, so
       a tinted row and the figure inside it can never drift apart. */
    --in:        #1d8a4e;   /* money received */
    --in-bg:     #e8f5ed;
    --in-line:   #cfe9d9;
    --late:      #d13b30;   /* overdue, bounced, failed */
    --late-bg:   #fdeceb;
    --late-line: #f3c6c2;
    --fee:       #b25000;   /* late fees, needs attention */
    --fee-bg:    #fdf1e3;
    --fee-line:  #f6dcc0;
    --flight:    #0d7f82;   /* paid by the tenant, still clearing */
    --flight-bg: #e6f5f5;
    --flight-line:#c6e6e6;
    --idle:      #8e8e93;   /* nothing to do yet */
    --idle-bg:   #f0f0f2;

    /* Older rules across these pages ask for --good / --bad / --warn by name.
       They are the same three colours, so they alias rather than duplicate:
       one hex, two names, no chance of drift. New code uses the semantic
       names above. */
    --good: var(--in);
    --bad:  var(--late);
    --warn: var(--fee);
    --info: var(--flight);

    --radius:    16px;
    --radius-sm: 10px;

    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'DM Sans', sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }

  /* ── Focus ────────────────────────────────────────────────────────────────
     One visible ring on everything operable. A keyboard landlord could
     previously tab through the whole month ledger with no idea where they
     were. */
  .fin :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 6px;
  }

  /* ── Type ─────────────────────────────────────────────────────────────── */
  .fin .title { font-size: 30px; font-weight: 600; letter-spacing: -0.022em; line-height: 1.15; }
  .fin .sub   { font-size: 14px; color: var(--ink-2); margin-top: 5px; letter-spacing: -0.01em; line-height: 1.5; }
  .fin .num   { font-variant-numeric: tabular-nums; }
  .fin .lnk   { color: var(--accent); text-decoration: none; }
  .fin .lnk:hover { text-decoration: underline; }
  .fin .muted { font-size: 13.5px; color: var(--ink-2); line-height: 1.6; letter-spacing: -0.01em; }
  .fin .muted.sm { font-size: 12.5px; }

  /* ── Buttons ──────────────────────────────────────────────────────────────
     Four roles, one shape language. Everything is 36px tall (44 on a phone, so
     it can be hit with a thumb), pill-cornered, and says what it does. */
  .fin .btn,
  .fin .btn-primary, .fin .btn-secondary, .fin .btn-ghost, .fin .btn-danger {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    min-height: 36px; padding: 8px 17px; border-radius: 980px;
    font-family: inherit; font-size: 14px; font-weight: 500; letter-spacing: -0.01em;
    white-space: nowrap; cursor: pointer; text-decoration: none;
    transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  }
  .fin .btn-primary {
    background: var(--accent); color: #fff; border: 1px solid var(--accent);
  }
  .fin .btn-primary:hover { background: var(--accent-ink); border-color: var(--accent-ink); }
  .fin .btn-secondary {
    background: var(--surface); color: var(--accent); border: 1px solid var(--line);
  }
  .fin .btn-secondary:hover { border-color: var(--accent); background: var(--accent-bg); }
  .fin .btn-ghost {
    background: none; border: 1px solid transparent; color: var(--accent);
    padding: 8px 10px;
  }
  .fin .btn-ghost:hover { background: var(--accent-bg); }
  .fin .btn-danger {
    background: var(--surface); color: var(--late); border: 1px solid var(--late-line);
  }
  .fin .btn-danger:hover { background: var(--late-bg); border-color: var(--late); }

  /* A text-only action, for inline use where a bordered control would shout.
     Kept as its own class because half the app already asks for it by name. */
  .fin .btn-quiet {
    background: none; border: none; padding: 0; color: var(--accent);
    font-family: inherit; font-size: 14px; letter-spacing: -0.01em;
    cursor: pointer; text-decoration: none; white-space: nowrap;
  }
  .fin .btn-quiet:hover { text-decoration: underline; }
  .fin .btn-quiet.sm { font-size: 13px; }

  .fin .btn-primary.sm, .fin .btn-secondary.sm, .fin .btn-danger.sm, .fin .btn-ghost.sm {
    min-height: 30px; padding: 5px 13px; font-size: 13px;
  }
  .fin .btn-primary:disabled, .fin .btn-secondary:disabled,
  .fin .btn-danger:disabled, .fin .btn-ghost:disabled, .fin .btn-quiet:disabled {
    opacity: 0.45; cursor: not-allowed; text-decoration: none;
  }
  /* A button mid-request says so, rather than looking ignored. */
  .fin [aria-busy="true"] { opacity: 0.7; cursor: progress; }

  /* ── Badges ───────────────────────────────────────────────────────────────
     One badge, five tones, used for charge states, email outcomes and lease
     stages alike. Three near-identical badge systems used to disagree about
     what amber meant. */
  .fin .badge, .fin .pill, .fin .st, .fin .out {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 500; letter-spacing: -0.005em;
    padding: 2px 9px; border-radius: 980px; white-space: nowrap;
    background: var(--idle-bg); color: var(--ink-2);
  }
  .fin .badge.in,    .fin .pill.good, .fin .st-good, .fin .out-good  { background: var(--in-bg);     color: var(--in); }
  .fin .badge.late,  .fin .pill.bad,  .fin .st-bad,  .fin .out-bad   { background: var(--late-bg);   color: var(--late); }
  .fin .badge.fee,   .fin .pill.warn, .fin .st-warn, .fin .out-warn  { background: var(--fee-bg);    color: var(--fee); }
  .fin .badge.flight,.fin .pill.info, .fin .st-info, .fin .out-info  { background: var(--flight-bg); color: var(--flight); }
  .fin .badge.idle,  .fin .pill.plain,.fin .st-quiet,.fin .out-quiet { background: var(--idle-bg);   color: var(--ink-2); }
  /* Figures take the same tones, so a red number and a red badge are the same red. */
  .fin .num.good, .fin .fig-in     { color: var(--in); }
  .fin .num.bad,  .fin .fig-late   { color: var(--late); font-weight: 600; }
  .fin .num.warn, .fin .fig-fee    { color: var(--fee); }
  .fin .num.info, .fin .fig-flight { color: var(--flight); }
  .fin .num.dim                    { color: var(--ink-3); }

  /* ── Segmented control ──────────────────────────────────────────────────── */
  .fin .seg {
    display: inline-flex; background: var(--line-2); border-radius: var(--radius-sm);
    padding: 2px; gap: 2px; max-width: 100%; overflow-x: auto;
  }
  .fin .seg-btn {
    display: inline-flex; align-items: center; gap: 7px; border: none; background: none;
    border-radius: 8px; padding: 7px 13px; min-height: 32px;
    font-family: inherit; font-size: 13px; color: var(--ink-2);
    cursor: pointer; white-space: nowrap; letter-spacing: -0.01em;
  }
  .fin .seg-btn:hover { color: var(--ink); }
  .fin .seg-btn.on {
    background: var(--surface); color: var(--ink); font-weight: 500;
    box-shadow: 0 1px 2px rgba(0,0,0,0.07);
  }
  /* A tab that is where the problems are says so before it is selected. */
  .fin .seg-btn.hot { color: var(--late); }
  .fin .seg-badge {
    background: rgba(0,0,0,0.07); border-radius: 980px; padding: 0 7px;
    font-size: 11px; font-variant-numeric: tabular-nums;
  }
  .fin .seg-btn.on .seg-badge { background: var(--line-2); }

  /* ── The money hub ────────────────────────────────────────────────────────
     Financials, the lease ledger and the reminders log are one place in a
     landlord's head: "the money". So they share a header — the same title row,
     the same two tabs, and exactly one primary action, which changes per view.
     Before this, each page restated its own identity and the only way from one
     to the other was the global sidebar. */
  .fin .hub { margin-bottom: 20px; }
  .fin .hub-crumbs {
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
    font-size: 12.5px; color: var(--ink-3); margin-bottom: 10px; letter-spacing: -0.01em;
  }
  .fin .hub-crumbs a { color: var(--ink-2); text-decoration: none; }
  .fin .hub-crumbs a:hover { color: var(--accent); text-decoration: underline; }
  .fin .hub-crumbs .sep { color: var(--line); }
  .fin .hub-top {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; flex-wrap: wrap;
  }
  .fin .hub-id { min-width: 0; }
  .fin .hub-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .fin .hub-tabs {
    display: flex; align-items: center; gap: 4px; margin-top: 18px;
    border-bottom: 1px solid var(--line);
  }
  .fin .hub-tab {
    position: relative; display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 14px 11px; border: none; background: none; cursor: pointer;
    font-family: inherit; font-size: 14px; color: var(--ink-2);
    letter-spacing: -0.01em; text-decoration: none;
  }
  .fin .hub-tab:hover { color: var(--ink); }
  .fin .hub-tab.on { color: var(--ink); font-weight: 500; }
  /* The underline sits on the border, so the selected tab reads as joined to
     the content below it rather than merely tinted. */
  .fin .hub-tab.on::after {
    content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px;
    height: 2px; background: var(--accent); border-radius: 2px;
  }
  .fin .hub-tab .seg-badge { background: var(--line-2); color: var(--ink-2); }
  .fin .hub-tab.alarm .seg-badge { background: var(--late-bg); color: var(--late); }

  /* ── Section headers ──────────────────────────────────────────────────── */
  .fin .sec-hd {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; flex-wrap: wrap; margin: 4px 0 12px;
  }
  .fin .sec-title { font-size: 17px; font-weight: 600; letter-spacing: -0.018em; }
  .fin .sec-note  { font-size: 12.5px; color: var(--ink-3); letter-spacing: -0.01em; }

  /* ── Panels and rows ──────────────────────────────────────────────────── */
  .fin .panel {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: 18px; margin-bottom: 16px; overflow: hidden;
  }
  .fin .panel-hd {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; padding: 18px 22px 14px;
  }
  .fin .panel-title { font-size: 16px; font-weight: 600; letter-spacing: -0.015em; }
  .fin .panel-note {
    font-size: 12.5px; color: var(--ink-3); letter-spacing: -0.01em;
    text-align: right; font-variant-numeric: tabular-nums;
  }
  .fin .panel-bd { padding: 4px 22px 20px; }
  .fin .panel-bd.flush { padding: 0; }
  .fin .panel-count {
    display: inline-block; margin-left: 8px; background: var(--late-bg); color: var(--late);
    font-size: 11.5px; font-weight: 600; border-radius: 980px; padding: 1px 8px;
    vertical-align: 2px; font-variant-numeric: tabular-nums;
  }

  /* Two affordances, never both on one row: a chevron means this opens
     somewhere else, a twist means it unfolds in place. The page used to mix
     them, so a landlord could not tell a navigation from an expansion. */
  .fin .row-chev {
    width: 7px; height: 7px; flex-shrink: 0;
    border-top: 1.6px solid #c7c7cc; border-right: 1.6px solid #c7c7cc;
    transform: rotate(45deg);
  }
  .fin .twist {
    width: 7px; height: 7px; flex-shrink: 0;
    border-right: 1.5px solid var(--ink-3); border-bottom: 1.5px solid var(--ink-3);
    transform: rotate(-45deg); transition: transform 0.15s;
  }
  .fin .twist.open { transform: rotate(45deg); }

  /* ── Attention banner ─────────────────────────────────────────────────────
     For the one thing on a screen that is actively costing the landlord money.
     It is a button because it always leads somewhere. */
  .fin .alarm-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    width: 100%; text-align: left; font-family: inherit; cursor: pointer;
    background: var(--late-bg); border: 1px solid var(--late-line);
    border-radius: 14px; padding: 13px 17px; margin-bottom: 18px;
    font-size: 13.5px; color: #8c2f26; line-height: 1.55; letter-spacing: -0.01em;
  }
  .fin .alarm-bar:hover { background: #fff2f0; }
  .fin .alarm-bar .go { color: var(--late); font-weight: 500; white-space: nowrap; }

  /* ── Empty, loading, error ──────────────────────────────────────────────── */
  .fin .empty {
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 54px 36px; text-align: center;
  }
  .fin .empty-title { font-size: 19px; font-weight: 600; letter-spacing: -0.015em; margin-bottom: 8px; }
  .fin .empty-sub {
    font-size: 14px; color: var(--ink-2); line-height: 1.6;
    max-width: 52ch; margin: 0 auto 22px; letter-spacing: -0.01em;
  }
  .fin .skeleton, .fin .skeleton-hero {
    height: 190px; border-radius: 18px;
    background: linear-gradient(90deg, var(--line-2), #f7f7f9, var(--line-2));
    background-size: 200% 100%; animation: fin-sk 1.4s ease-in-out infinite;
  }
  @keyframes fin-sk { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }

  /* ── What the colours mean ────────────────────────────────────────────────
     A palette has to be teachable exactly once. */
  .fin .key { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 11.5px; color: var(--ink-3); }
  .fin .key-item { display: inline-flex; align-items: center; gap: 5px; }
  .fin .key-dot { width: 7px; height: 7px; border-radius: 50%; }
  .fin .key-dot.in { background: var(--in); }
  .fin .key-dot.late { background: var(--late); }
  .fin .key-dot.fee { background: var(--fee); }
  .fin .key-dot.flight { background: var(--flight); }
  .fin .key-dot.idle { background: var(--idle); }

  @media (max-width: 700px) {
    /* Thumb-sized targets on a phone. A landlord chasing rent is usually not
       at a desk. */
    .fin .btn-primary, .fin .btn-secondary, .fin .btn-danger { min-height: 44px; padding: 11px 20px; }
    .fin .btn-primary.sm, .fin .btn-secondary.sm, .fin .btn-danger.sm { min-height: 38px; }
    .fin .seg-btn { min-height: 38px; }
    .fin .hub-tab { padding: 11px 12px 13px; }
    .fin .title { font-size: 25px; }
  }
`

/** Where a money screen sits, for the hub header's tabs. */
export type HubTab = 'overview' | 'payments' | 'reminders'
