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

    /* Interactive — the brand green.
       This was Apple blue, under a rule that said "blue means interactive and
       nothing informational is ever blue". The portal has moved to a green
       admin shell, and an area whose buttons are blue inside a chrome whose
       buttons are green reads as two products bolted together.
       The old rule's *purpose* survives, carried by shape instead of hue: an
       action is a filled pill or an underlined link, a figure never is. Green
       therefore means "good or pressable", and the thing that tells you which
       is whether it has a button around it. See the note above --in.
       5.4:1 on white, and white on it is the same — so it works as a fill and
       as text. */
    --accent:     #0f7a43;
    --accent-ink: #0b6336;
    --accent-bg:  #e8f4ed;

    /* State. Each one has a strong form for text and a soft form for fills, so
       a tinted row and the figure inside it can never drift apart. */
    /* Money received — the same green as --accent, on purpose.
       Two greens one step apart looked like a mistake rather than a
       distinction, and the lighter of them only reached 3.6:1 on white, which
       fails normal-text contrast for every collected figure on the page. So
       there is one green, it means "good or pressable", and what tells those
       apart is shape: an action is a filled pill or an underlined link, a
       figure never is. 5.4:1 on white. */
    --in:        #0f7a43;   /* money received */
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
  /* Five sections plus Reminders does not fit a phone, so the strip scrolls
     rather than wrapping into two rows that push the page down. */
  .fin .hub-tabs { overflow-x: auto; scrollbar-width: none; }
  .fin .hub-tabs::-webkit-scrollbar { display: none; }
  .fin .hub-tab { flex-shrink: 0; }

  /* Every page in the area puts its own controls in the same place: directly
     under the tabs, above the first figure. */
  .fin .hub-filters {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 16px 0 2px;
  }

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

  /* ── Page shell ───────────────────────────────────────────────────────────
     The working pages use the full width of the window.

     They were capped at 1180px and centred, which on a 1600px desktop left
     two columns of empty grey either side while the tables inside scrolled
     horizontally — the classic failure of a content width borrowed from
     reading layouts and applied to an admin tool. A rent ledger wants every
     pixel it can get.

     Two pages keep a cap, for opposite reasons: a statement is a document
     that will be printed, and Insights is prose. Measure matters there;
     elsewhere it does not. */
  .fin-wrap { max-width: none; margin: 0; padding: 26px 30px 90px; }
  .fin-wrap.narrow { max-width: 1040px; margin: 0 auto; }

  @media (min-width: 1700px) {
    /* Past this the eye has to travel too far across a table row, so the
       content stops growing and simply centres. */
    .fin-wrap { max-width: 1680px; margin: 0 auto; }
  }

  /* ── Big numbers ──────────────────────────────────────────────────────────
     The overview is read at a glance from arm's length, which means the figure
     is the largest thing in the tile and everything else is subordinate to it.
     A "lead" tile is double width, for the one question that is not one of
     four equal questions. */
  .fin .kpis {
    display: grid; gap: 12px; margin-bottom: 20px;
    grid-template-columns: repeat(auto-fit, minmax(188px, 1fr));
  }
  .fin .kpi {
    position: relative; background: var(--surface); border: 1px solid var(--line);
    border-radius: 16px; padding: 16px 17px 15px; text-align: left;
    font-family: inherit; color: inherit; display: block; min-width: 0;
  }
  .fin a.kpi, .fin button.kpi {
    cursor: pointer; text-decoration: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .fin a.kpi:hover, .fin button.kpi:hover {
    border-color: #d9d9de; box-shadow: 0 2px 10px rgba(0,0,0,0.045);
  }
  .fin .kpi.lead { grid-column: span 2; }
  .fin .kpi-label {
    font-size: 11.5px; color: var(--ink-3); letter-spacing: 0.005em;
    text-transform: uppercase; font-weight: 500;
  }
  .fin .kpi-value {
    font-size: 29px; font-weight: 600; letter-spacing: -0.028em; line-height: 1.1;
    margin-top: 7px; font-variant-numeric: tabular-nums;
  }
  .fin .kpi.lead .kpi-value { font-size: 38px; }
  .fin .kpi-value.good { color: var(--in); }
  .fin .kpi-value.bad  { color: var(--late); }
  .fin .kpi-value.warn { color: var(--fee); }
  .fin .kpi-value.info { color: var(--flight); }
  .fin .kpi-meta {
    font-size: 12.5px; color: var(--ink-2); margin-top: 6px;
    line-height: 1.5; letter-spacing: -0.01em;
  }
  .fin .kpi-foot {
    font-size: 11.5px; color: var(--ink-3); margin-top: 7px;
    padding-top: 7px; border-top: 1px solid var(--line-2); line-height: 1.5;
  }
  /* A tile that is a door says so, quietly, in its own corner. */
  .fin .kpi-go { font-size: 11.5px; color: var(--accent); margin-top: 8px; display: block; }
  /* The one tile actively costing money gets a tinted edge — never a full red
     fill, which would make the whole screen feel like an error. */
  .fin .kpi.hot  { border-color: var(--late-line); background: #fffafa; }
  .fin .kpi.warm { border-color: var(--fee-line);  background: #fffcf8; }

  /* ── Cards ────────────────────────────────────────────────────────────────
     The overview is cards; the detail pages are panels and tables. A card can
     be a link in its entirety, which a panel never is. */
  .fin .cards { display: grid; gap: 14px; margin-bottom: 18px; }
  .fin .cards.two   { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
  .fin .cards.three { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .fin .card {
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 18px 20px; min-width: 0;
  }
  .fin .card-hd {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
  }
  .fin .card-title { font-size: 15px; font-weight: 600; letter-spacing: -0.015em; }
  .fin .card-note {
    font-size: 12px; color: var(--ink-3); letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums; text-align: right;
  }
  .fin .card-ft {
    margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--line-2);
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    flex-wrap: wrap; font-size: 12.5px; color: var(--ink-3); line-height: 1.5;
  }

  /* ── Filter bar ───────────────────────────────────────────────────────────
     Detail pages exist to be cut and sliced, so their controls are a
     first-class row: one line, left to right, in the same place on every page,
     with the reset appearing only once something is actually filtered. */
  .fin .filters { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .fin .fsel {
    appearance: none; background: var(--surface) no-repeat right 9px center;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238e8e93' stroke-width='1.5' stroke-linecap='round'/></svg>");
    border: 1px solid var(--line); border-radius: 9px; padding: 7px 28px 7px 11px;
    font-family: inherit; font-size: 13px; color: var(--ink); min-height: 34px;
    cursor: pointer; letter-spacing: -0.01em; max-width: 240px;
  }
  .fin .fsel:hover { border-color: #d9d9de; }
  .fin .fsel.on { border-color: var(--accent); color: var(--accent-ink); }
  .fin .fsearch {
    border: 1px solid var(--line); border-radius: 9px; padding: 7px 12px;
    font-family: inherit; font-size: 13px; min-height: 34px; min-width: 190px;
    letter-spacing: -0.01em; background: var(--surface); color: var(--ink);
  }
  .fin .fsearch::placeholder { color: var(--ink-3); }
  .fin .fcount {
    font-size: 12.5px; color: var(--ink-3); margin-left: auto; letter-spacing: -0.01em;
  }

  /* ── Tables ───────────────────────────────────────────────────────────────
     Scanning work — reconciling, chasing, comparing — is a table: one row per
     thing, the same columns in the same places, sortable on the column being
     worked. Panels are for drilling; a table is for scanning. */
  .fin .tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .fin .tbl th, .fin .tbl td { text-align: left; padding: 11px 12px; vertical-align: middle; }
  .fin .tbl thead th {
    font-size: 11px; font-weight: 500; color: var(--ink-3); text-transform: uppercase;
    letter-spacing: 0.03em; border-bottom: 1px solid var(--line); white-space: nowrap;
    position: sticky; top: 0; background: var(--surface); z-index: 1;
  }
  .fin .tbl tbody tr { border-bottom: 1px solid var(--line-2); }
  .fin .tbl tbody tr:last-child { border-bottom: none; }
  .fin .tbl tbody tr.click { cursor: pointer; }
  .fin .tbl tbody tr.click:hover { background: var(--surface-2); }
  .fin .tbl td.num, .fin .tbl th.num {
    text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .fin .tbl-sort {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
    text-transform: inherit; letter-spacing: inherit;
  }
  .fin .tbl-sort:hover { color: var(--ink); }
  .fin .tbl-sort .caret { font-size: 9px; color: var(--accent); }
  .fin .tbl-scroll { overflow-x: auto; }
  /* The cell that holds a name with a line of context under it. */
  .fin .cell-main { min-width: 0; }
  .fin .cell-main b { font-weight: 500; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .fin .cell-main em {
    font-style: normal; display: block; font-size: 11.5px; color: var(--ink-3);
    margin-top: 2px; letter-spacing: -0.005em;
  }

  /* ── Tree rows ────────────────────────────────────────────────────────────
     Property → lease → plan → payer. The indent and the rule down the left are
     what carry the depth: a landlord three levels in has to be able to see,
     without reading, that they are inside something. */
  .fin .tree { display: flex; flex-direction: column; }
  .fin .tnode { border-bottom: 1px solid var(--line-2); }
  .fin .tnode:last-child { border-bottom: none; }
  .fin .trow {
    display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
    padding: 15px 20px; background: none; border: none; font-family: inherit;
    color: inherit; cursor: pointer;
  }
  .fin .trow:hover { background: var(--surface-2); }
  .fin .trow-main { flex: 1; min-width: 0; }
  .fin .trow-name {
    font-size: 15px; font-weight: 600; letter-spacing: -0.016em;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .fin .trow-sub {
    font-size: 12.5px; color: var(--ink-2); margin-top: 3px; line-height: 1.5;
    letter-spacing: -0.01em;
  }
  .fin .trow-figs { display: flex; align-items: center; gap: 20px; flex-shrink: 0; }
  .fin .tfig { text-align: right; }
  .fin .tfig b { font-size: 14.5px; font-weight: 600; display: block; font-variant-numeric: tabular-nums; }
  .fin .tfig b.owed { color: var(--late); }
  .fin .tfig b.good { color: var(--in); }
  .fin .tfig em { font-style: normal; font-size: 11px; color: var(--ink-3); display: block; margin-top: 1px; }
  .fin .tkids { background: var(--surface-2); border-top: 1px solid var(--line-2); }
  .fin .tkid { border-left: 2px solid var(--line); margin-left: 20px; }

  /* ── Drawer ───────────────────────────────────────────────────────────────
     Every detail that is not a page is this: a right-hand sheet over the
     current view, so a landlord inspecting a charge never loses the list they
     found it in. */
  .fin .sheet-wrap { position: fixed; inset: 0; z-index: 90; display: flex; justify-content: flex-end; }
  .fin .sheet-scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.28); }
  .fin .sheet {
    position: relative; width: min(560px, 100%); height: 100%; background: var(--surface);
    display: flex; flex-direction: column; box-shadow: -8px 0 40px rgba(0,0,0,0.14);
    animation: fin-slide 0.22s cubic-bezier(0.32,0.72,0,1);
  }
  @keyframes fin-slide { from { transform: translateX(22px); opacity: 0.6 } to { transform: none; opacity: 1 } }
  .fin .sheet-hd {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
    padding: 20px 22px 16px; border-bottom: 1px solid var(--line);
  }
  .fin .sheet-title {
    font-size: 18px; font-weight: 600; letter-spacing: -0.02em;
    display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  }
  .fin .sheet-sub { font-size: 12.5px; color: var(--ink-2); margin-top: 4px; line-height: 1.55; }
  .fin .sheet-x {
    background: none; border: none; font-size: 26px; line-height: 1; color: var(--ink-3);
    cursor: pointer; padding: 0 2px; flex-shrink: 0;
  }
  .fin .sheet-x:hover { color: var(--ink); }
  .fin .sheet-bd { flex: 1; overflow-y: auto; padding: 4px 22px 22px; }
  .fin .sheet-sec { padding: 18px 0; border-bottom: 1px solid var(--line-2); }
  .fin .sheet-sec:last-child { border-bottom: none; }
  .fin .sheet-sec-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    margin-bottom: 10px;
  }
  .fin .sheet-sec-hd h3 { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
  .fin .sheet-sec-hd span { font-size: 11.5px; color: var(--ink-3); text-align: right; }
  .fin .sheet-ft {
    display: flex; align-items: center; justify-content: flex-end; gap: 10px;
    padding: 14px 22px; border-top: 1px solid var(--line); flex-wrap: wrap;
  }
  .fin .sheet-link { margin-top: 10px; }
  /* A line of a breakdown: label left, money right, and a total that is
     visibly a total. */
  .fin .sline {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 7px 0; font-size: 13.5px; letter-spacing: -0.01em;
  }
  .fin .sline-lbl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .fin .sline-note { display: block; width: 100%; font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
  .fin .sline-amt { font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; }
  .fin .sline-amt.owed { color: var(--late); font-weight: 600; }
  .fin .sline-amt.good { color: var(--in); }
  .fin .sline.fee { color: var(--fee); }
  .fin .sline.sub { border-top: 1px solid var(--line-2); margin-top: 4px; padding-top: 9px; font-weight: 500; }
  .fin .sline.total {
    border-top: 1px solid var(--line); margin-top: 6px; padding-top: 11px;
    font-weight: 600; font-size: 14.5px;
  }

  /* ── Jump nav ───────────────────────────────────────────────────────────── */
  .fin .jump { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 18px; }
  .fin .jump a {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px;
    color: var(--ink-2); text-decoration: none; padding: 5px 11px;
    border-radius: 980px; background: var(--line-2); letter-spacing: -0.01em;
  }
  .fin .jump a:hover { background: var(--accent-bg); color: var(--accent-ink); }
  .fin .jump-n { font-size: 10.5px; font-variant-numeric: tabular-nums; font-weight: 600; }
  .fin .jump-n.late { color: var(--late); }
  .fin .jump-n.fee  { color: var(--fee); }

  .fin .panel-ft {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    flex-wrap: wrap; padding: 13px 22px; border-top: 1px solid var(--line-2);
    background: var(--surface-2); font-size: 12.5px; color: var(--ink-2); line-height: 1.55;
  }
  .fin .pad { padding: 2px 22px 16px; }
  .fin .num.owed { color: var(--late); font-weight: 600; }

  @media (max-width: 860px) {
    .fin .kpi.lead { grid-column: span 1; }
    .fin .kpi.lead .kpi-value { font-size: 31px; }
  }
  @media (max-width: 700px) {
    .fin-wrap { padding: 20px 15px 80px; }
    .fin .kpis { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 9px; }
    .fin .kpi { padding: 13px 14px; border-radius: 14px; }
    .fin .kpi-value { font-size: 24px; }
    .fin .card { padding: 15px; border-radius: 15px; }
    .fin .trow { padding: 13px 14px; gap: 9px; }
    .fin .trow-figs { gap: 13px; }
    .fin .sheet { width: 100%; }
    .fin .tkid { margin-left: 10px; }
  }

  /* ══ THE SECOND PASS ═══════════════════════════════════════════════════════
     Everything below was added once the structure was right and the area still
     read flat. Three things were missing: a sense of depth (every surface sat
     at exactly the same altitude), a single place for the eye to land first,
     and any way to move without using the mouse. */

  /* ── Elevation ────────────────────────────────────────────────────────────
     Two levels and no more. A card at rest is defined by its hairline, not by
     a shadow — money screens with drop shadows everywhere look like a
     consumer app and read as less trustworthy. The shadow appears on *lift*
     (hover, the open sheet, the palette), where it means "this is above the
     page", which is information rather than decoration. */
  .fin {
    --lift-1: 0 1px 2px rgba(0,0,0,0.04), 0 2px 10px rgba(0,0,0,0.04);
    --lift-2: 0 8px 30px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05);
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
  }
  .fin a.kpi:hover, .fin button.kpi:hover { box-shadow: var(--lift-1); }
  .fin .card { transition: box-shadow 0.18s var(--ease), border-color 0.18s var(--ease); }

  /* ── The pulse band ───────────────────────────────────────────────────────
     The first thing on the overview, and the one thing a landlord who reads
     nothing else should still leave knowing: the state of the business in a
     sentence, and the single thing to press.

     It is a band rather than a tile because it is not one of a set — it is the
     page's thesis. The tone is carried by a left edge and a faint wash, never
     a saturated fill: a full red banner across the top of a money page makes a
     portfolio with one late tenant feel like an emergency. */
  .fin .pulse {
    position: relative; display: flex; align-items: flex-start; gap: 18px;
    justify-content: space-between; flex-wrap: wrap;
    background: var(--surface); border: 1px solid var(--line);
    border-left: 3px solid var(--idle); border-radius: 18px;
    padding: 22px 24px; margin-bottom: 18px; overflow: hidden;
  }
  .fin .pulse.calm     { border-left-color: var(--in);   background: linear-gradient(100deg, var(--in-bg) 0%, var(--surface) 42%); }
  .fin .pulse.warning  { border-left-color: var(--fee);  background: linear-gradient(100deg, var(--fee-bg) 0%, var(--surface) 42%); }
  .fin .pulse.critical { border-left-color: var(--late); background: linear-gradient(100deg, var(--late-bg) 0%, var(--surface) 42%); }
  .fin .pulse-main { min-width: 0; flex: 1 1 420px; }
  .fin .pulse-eyebrow {
    display: flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.055em; color: var(--ink-3); margin-bottom: 9px;
  }
  .fin .pulse-head {
    font-size: 26px; font-weight: 600; letter-spacing: -0.026em; line-height: 1.18;
    font-variant-numeric: tabular-nums;
  }
  .fin .pulse.critical .pulse-head { color: var(--late); }
  .fin .pulse-line {
    font-size: 14px; color: var(--ink-2); line-height: 1.6; margin-top: 8px;
    letter-spacing: -0.01em; max-width: 76ch;
  }
  .fin .pulse-act { flex-shrink: 0; padding-top: 4px; }

  /* ── Signals ──────────────────────────────────────────────────────────────
     The judgement layer. Each row is a claim with its evidence folded
     underneath, because a landlord believes the second one only if the first
     one showed its working. Collapsed by default: five open signals is the
     wall this whole redesign was escaping. */
  .fin .sigs { display: flex; flex-direction: column; }
  .fin .sig { border-top: 1px solid var(--line-2); }
  .fin .sig:first-child { border-top: none; }
  .fin .sig-row {
    display: flex; align-items: flex-start; gap: 13px; width: 100%; text-align: left;
    padding: 14px 2px; background: none; border: none; font-family: inherit;
    color: inherit; cursor: pointer;
  }
  .fin .sig-row:hover { background: var(--surface-2); }
  .fin .sig-main { flex: 1; min-width: 0; }
  .fin .sig-title {
    font-size: 14px; font-weight: 500; letter-spacing: -0.012em; line-height: 1.45;
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  }
  .fin .sig-tag {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
    padding: 1px 6px; border-radius: 4px; background: var(--idle-bg); color: var(--ink-3);
  }
  .fin .sig-tag.critical { background: var(--late-bg);   color: var(--late); }
  .fin .sig-tag.warning  { background: var(--fee-bg);    color: var(--fee); }
  .fin .sig-tag.watch    { background: var(--flight-bg); color: var(--flight); }
  .fin .sig-tag.good     { background: var(--in-bg);     color: var(--in); }
  .fin .sig-detail {
    font-size: 12.5px; color: var(--ink-2); line-height: 1.6; margin-top: 5px;
    letter-spacing: -0.005em; max-width: 84ch;
  }
  .fin .sig-body { padding: 0 2px 16px 56px; }
  .fin .sig-ev {
    list-style: none; margin: 0 0 13px; padding: 0;
    border-left: 2px solid var(--line); padding-left: 13px;
  }
  .fin .sig-ev li {
    font-size: 12.5px; color: var(--ink-2); line-height: 1.65; padding: 2px 0;
    font-variant-numeric: tabular-nums;
  }
  .fin .sig-twist { margin-top: 10px; }

  /* ── Command palette ──────────────────────────────────────────────────────
     The answer to "I can't find the payment plan" that no amount of hierarchy
     fixes on its own: a landlord with forty tenancies should type three
     letters of a tenant's name and be there. Professional tools are
     keyboard-first; this is the one piece of this area that makes it feel like
     one. */
  .fin-cmdk-wrap {
    position: fixed; inset: 0; z-index: 120; display: flex; justify-content: center;
    align-items: flex-start; padding: 12vh 18px 18px;
  }
  .fin-cmdk-scrim { position: absolute; inset: 0; background: rgba(20,20,22,0.34); }
  .fin-cmdk {
    position: relative; width: 100%; max-width: 580px; background: var(--surface);
    border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--lift-2);
    overflow: hidden; display: flex; flex-direction: column; max-height: 70vh;
    animation: fin-pop 0.16s var(--ease);
  }
  @keyframes fin-pop { from { transform: translateY(-6px) scale(0.99); opacity: 0 } to { transform: none; opacity: 1 } }
  .fin-cmdk-top {
    display: flex; align-items: center; gap: 11px; padding: 14px 17px;
    border-bottom: 1px solid var(--line); color: var(--ink-3);
  }
  .fin-cmdk-input {
    flex: 1; border: none; outline: none; background: none; font-family: inherit;
    font-size: 16px; color: var(--ink); letter-spacing: -0.012em; min-width: 0;
  }
  .fin-cmdk-input::placeholder { color: var(--ink-3); }
  .fin-cmdk-esc {
    font-size: 10.5px; color: var(--ink-3); border: 1px solid var(--line);
    border-radius: 5px; padding: 2px 6px; flex-shrink: 0;
  }
  .fin-cmdk-list { overflow-y: auto; padding: 6px; }
  .fin-cmdk-group {
    font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--ink-3); padding: 10px 11px 5px;
  }
  .fin-cmdk-item {
    display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
    padding: 9px 11px; border: none; background: none; border-radius: 9px;
    font-family: inherit; color: inherit; cursor: pointer;
  }
  .fin-cmdk-item.on { background: var(--accent-bg); }
  .fin-cmdk-item .ci-main { flex: 1; min-width: 0; }
  .fin-cmdk-item .ci-name {
    font-size: 14px; letter-spacing: -0.011em; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .fin-cmdk-item .ci-sub {
    font-size: 11.5px; color: var(--ink-3); margin-top: 1px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .fin-cmdk-item .ci-fig {
    font-size: 12px; font-variant-numeric: tabular-nums; color: var(--ink-2); flex-shrink: 0;
  }
  .fin-cmdk-item .ci-fig.owed { color: var(--late); font-weight: 600; }
  .fin-cmdk-empty { padding: 30px 18px; text-align: center; font-size: 13.5px; color: var(--ink-2); }
  .fin-cmdk-foot {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 10px 16px; border-top: 1px solid var(--line-2);
    font-size: 11px; color: var(--ink-3); background: var(--surface-2);
  }
  .fin-cmdk-foot kbd {
    font-family: inherit; font-size: 10px; border: 1px solid var(--line);
    border-radius: 4px; padding: 1px 5px; margin-right: 4px; background: var(--surface);
  }
  /* The affordance. Without something visible saying the palette exists, a
     keyboard feature is a secret. */
  .fin .find-btn {
    display: inline-flex; align-items: center; gap: 9px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 980px;
    padding: 7px 12px 7px 11px; font-family: inherit; font-size: 13px;
    color: var(--ink-3); cursor: pointer; letter-spacing: -0.01em; min-height: 34px;
  }
  .fin .find-btn:hover { border-color: var(--accent); color: var(--accent); }
  .fin .find-btn kbd {
    font-family: inherit; font-size: 10.5px; border: 1px solid var(--line);
    border-radius: 4px; padding: 1px 5px; color: var(--ink-3);
  }

  /* ── Reliability bands ────────────────────────────────────────────────────
     A payer's own payment history, as a word plus a tone. Never a letter grade
     and never a bare score: "B−" tells a landlord nothing they can act on,
     where "late on 5 of 6, typically 9 days" tells them everything. */
  .fin .band {
    display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500;
    padding: 2px 9px; border-radius: 980px; white-space: nowrap;
    background: var(--idle-bg); color: var(--ink-2);
  }
  .fin .band.reliable   { background: var(--in-bg);     color: var(--in); }
  .fin .band.slips      { background: var(--fee-bg);    color: var(--fee); }
  .fin .band.chronic    { background: var(--fee-bg);    color: var(--fee); }
  .fin .band.delinquent { background: var(--late-bg);   color: var(--late); }
  .fin .band-dots { display: inline-flex; gap: 2px; }
  .fin .band-dot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: 0.3; }
  .fin .band-dot.on { opacity: 1; }

  /* ── Motion ───────────────────────────────────────────────────────────────
     Content arrives rather than appearing. Short, once, and never on a figure
     that is being read — a money number that animates is a number you cannot
     trust at a glance. */
  .fin .rise { animation: fin-rise 0.26s var(--ease) both; }
  @keyframes fin-rise { from { opacity: 0; transform: translateY(5px) } to { opacity: 1; transform: none } }
  @media (prefers-reduced-motion: reduce) {
    .fin .rise, .fin .sheet, .fin-cmdk { animation: none; }
    .fin * { transition-duration: 0.01ms !important; }
  }

  /* ── Print ────────────────────────────────────────────────────────────────
     A landlord's accountant, lender and lawyer all want this on paper, and the
     browser's default output of a dashboard is unusable. Chrome, tabs, filters
     and anything interactive come out; the figures and tables stay. */
  @media print {
    .fin { --surface: #fff; --surface-2: #fff; }
    .fin .hub-tabs, .fin .hub-filters, .fin .hub-actions, .fin .jump,
    .fin .find-btn, .fin .seg, .fin .filters, .fin .sheet-wrap, .fin-cmdk-wrap,
    .fin .row-chev, .fin .twist, .fin .alarm-bar, .fin .kpi-go { display: none !important; }
    .fin-wrap { max-width: none; padding: 0; }
    .fin .card, .fin .panel, .fin .kpi, .fin .pulse {
      border: 1px solid #ddd !important; box-shadow: none !important;
      break-inside: avoid; background: #fff !important;
    }
    .fin .pulse { border-left-width: 1px !important; }
    .fin .kpis { display: grid !important; grid-template-columns: repeat(4, 1fr) !important; }
    .fin .kpi.lead { grid-column: span 2 !important; }
    .fin .title { font-size: 20pt; }
    .fin .kpi-value { font-size: 15pt; }
    .fin .tbl { font-size: 9pt; }
    .fin .tbl thead th { position: static; }
    .fin a { text-decoration: none; color: inherit; }
    /* A URL printed after every link turns a table into noise. */
    .fin a[href]::after { content: none !important; }
  }
`

/** Where a money screen sits, for the hub header's tabs. */
export type HubTab =
  | 'overview'     // is anything wrong
  | 'portfolio'    // property → lease → plan → payer
  | 'collections'  // who is behind, and the work on it
  | 'schedule'     // what falls due when
  | 'payments'     // what actually arrived
  | 'reminders'    // what was emailed about it
