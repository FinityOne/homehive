import type { Lead } from './leads'

/**
 * Next-Best-Action engine for the lead detail page.
 *
 * This is a deterministic, template-based "follow-up consultant": given where a
 * lead sits in the funnel (status + whether they've pre-screened, toured, have a
 * live offer, etc.) it returns the single highest-leverage next step plus a short
 * ranked list of supporting plays. The component maps each action's `id` to a
 * real handler, so the engine stays pure and testable.
 *
 * Philosophy (30 years of leasing follow-up, distilled):
 *  - Speed-to-lead wins. A brand-new lead's #1 job is human contact today.
 *  - Pre-screen is the qualifying gate. No pre-screen → get it done.
 *  - A qualified lead's job is to TOUR. A toured lead's job is an OFFER.
 *  - An accepted offer is a deal — switch from "selling" to "closing" (lease).
 *  - Momentum decays. Aging leads need a channel switch (call/text), not another email.
 */

export type LeadStatus = Lead['status']

export type ReservationState = 'none' | 'pending' | 'accepted' | 'expired'

export type LeadActionContext = {
  status: LeadStatus
  closedReason: Lead['closed_reason'] | null
  firstName: string
  hoursSinceCreated: number | null
  hasPrescreen: boolean
  toured: boolean              // has a completed/past tour
  hasUpcomingTour: boolean     // a confirmed tour still in the future
  tourDaysUntil: number | null // days until the confirmed tour (>=0 upcoming, <0 past)
  tourReminderSent: boolean
  reservation: ReservationState
  budgetRatio: number | null   // pre-screen budget ÷ listing rent
  moveInMonths: number | null  // months from now until desired move-in
  groupSize: number | null
  matchScore: number | null
  hasPhone: boolean
}

// Every action the engine can recommend. The component owns the handlers.
export type ActionId =
  | 'call_now'
  | 'text_followup'
  | 'send_prescreen'
  | 'copy_prescreen_link'
  | 'invite_tour'
  | 'book_tour_manual'
  | 'send_tour_reminder'
  | 'prep_unit'
  | 'reschedule_tour'
  | 'build_offer'
  | 'view_offer'
  | 'new_offer'
  | 'discuss_pricing'
  | 'start_lease'
  | 'collect_deposit'
  | 'confirm_occupants'
  | 'mark_contacted'
  | 'mark_engaged'
  | 'close_leased'
  | 'reactivate'
  | 'ask_referral'
  | 'reopen_lead'

// How the action is carried out — drives the little tag + styling in the UI.
export type ActionKind =
  | 'oneclick'   // fires a real action immediately (email send, status change)
  | 'builder'    // opens an in-app modal/builder
  | 'link'       // navigates somewhere in-app
  | 'call'       // dials / opens phone
  | 'copy'       // copies a script to clipboard
  | 'offline'    // a real-world task to do off-platform

export type RecommendedAction = {
  id: ActionId
  label: string
  detail: string
  icon: string
  kind: ActionKind
}

export type NextBestPlan = {
  stageLabel: string   // where the lead is in the journey
  headline: string     // the single most important thing to do, in plain language
  reasoning: string    // 1–2 sentences of "why now"
  primary: RecommendedAction
  secondary: RecommendedAction[]
  urgency: 'now' | 'today' | 'soon' | 'low'
}

const KIND_FALLBACK: Record<ActionKind, string> = {
  oneclick: '1-click',
  builder: 'Opens builder',
  link: 'Opens page',
  call: 'Call',
  copy: 'Copy script',
  offline: 'Off-platform',
}

// Build a full action object for an id, interpolating the lead's name/context.
function mk(id: ActionId, ctx: LeadActionContext): RecommendedAction {
  const name = ctx.firstName || 'this lead'
  const map: Record<ActionId, Omit<RecommendedAction, 'id'>> = {
    call_now: {
      label: `Call ${name} now`,
      detail: 'A live call in the first hour converts far better than any email. Copies a call script too.',
      icon: '📞', kind: 'call',
    },
    text_followup: {
      label: 'Text a quick follow-up',
      detail: 'Copies a ready-to-send personal message — texts get read in minutes.',
      icon: '💬', kind: 'copy',
    },
    send_prescreen: {
      label: 'Send pre-screen invite',
      detail: 'Emails the pre-screen so you can qualify budget, move-in and group size.',
      icon: '📧', kind: 'oneclick',
    },
    copy_prescreen_link: {
      label: 'Copy pre-screen link',
      detail: 'Paste it into a text or DM to qualify them on their channel of choice.',
      icon: '🔗', kind: 'copy',
    },
    invite_tour: {
      label: 'Invite to tour',
      detail: 'Sends a booking link so they pick a time from your calendar — zero back-and-forth.',
      icon: '🎉', kind: 'oneclick',
    },
    book_tour_manual: {
      label: 'Book the tour for them',
      detail: 'Already agreed on a time by phone? Lock it in and the confirmation goes out automatically.',
      icon: '📅', kind: 'builder',
    },
    send_tour_reminder: {
      label: 'Send tour reminder',
      detail: 'A 24-hour reminder slashes no-shows. Reconfirms date, time and address.',
      icon: '🔔', kind: 'oneclick',
    },
    prep_unit: {
      label: 'Get the unit show-ready',
      detail: 'Clean, lights on, declutter. First impressions decide whether they apply.',
      icon: '🧹', kind: 'offline',
    },
    reschedule_tour: {
      label: 'Reschedule the tour',
      detail: 'Pick a new slot and resend the confirmation in one step.',
      icon: '↻', kind: 'builder',
    },
    build_offer: {
      label: 'Build & send reservation offer',
      detail: 'Strike while it’s warm — a deadlined offer right after a tour is the #1 way to close.',
      icon: '🔒', kind: 'builder',
    },
    view_offer: {
      label: 'View / resend the offer',
      detail: 'Re-open the live offer to resend it or nudge them before it expires.',
      icon: '👁', kind: 'link',
    },
    new_offer: {
      label: 'Send a fresh offer',
      detail: 'The last offer lapsed. A new deadline rebuilds urgency.',
      icon: '🔄', kind: 'builder',
    },
    discuss_pricing: {
      label: 'Address the budget gap',
      detail: 'Their budget is under asking — copy a message floating flexible terms or a move-in incentive.',
      icon: '💰', kind: 'copy',
    },
    start_lease: {
      label: 'Prepare & send the lease',
      detail: 'They’re ready to sign. Open the lease builder and get the paperwork out today.',
      icon: '📄', kind: 'link',
    },
    collect_deposit: {
      label: 'Collect the holding deposit',
      detail: 'Secure the room with a deposit before drafting the lease — off-platform via your usual method.',
      icon: '💵', kind: 'offline',
    },
    confirm_occupants: {
      label: 'Confirm all occupants',
      detail: 'It’s a group — make sure every adult will be named on the lease before you proceed.',
      icon: '👥', kind: 'offline',
    },
    mark_contacted: {
      label: 'Mark as contacted',
      detail: 'Move them to Contacted so your pipeline reflects reality.',
      icon: '✓', kind: 'oneclick',
    },
    mark_engaged: {
      label: 'Mark as engaged',
      detail: 'They’re replying and interested — advance the stage.',
      icon: '✓', kind: 'oneclick',
    },
    close_leased: {
      label: 'Mark as leased 🎉',
      detail: 'Deal done — close the lead as leased and track them for referrals.',
      icon: '🏆', kind: 'oneclick',
    },
    reactivate: {
      label: 'Send a reactivation note',
      detail: 'A short, friendly “still looking?” email is the cheapest way to revive a cold lead.',
      icon: '✦', kind: 'oneclick',
    },
    ask_referral: {
      label: 'Ask for a referral',
      detail: 'Copy a message asking if any friends are still looking — your warmest source of new leads.',
      icon: '🤝', kind: 'copy',
    },
    reopen_lead: {
      label: 'Reopen this lead',
      detail: 'Circumstances changed? Move them back into the active pipeline.',
      icon: '↩', kind: 'oneclick',
    },
  }
  return { id, ...map[id] }
}

function plan(
  ctx: LeadActionContext,
  stageLabel: string,
  headline: string,
  reasoning: string,
  urgency: NextBestPlan['urgency'],
  primaryId: ActionId,
  secondaryIds: ActionId[],
): NextBestPlan {
  // De-dupe and drop the primary if it slipped into secondary.
  const seen = new Set<ActionId>([primaryId])
  const secondary: RecommendedAction[] = []
  for (const id of secondaryIds) {
    if (seen.has(id)) continue
    seen.add(id)
    secondary.push(mk(id, ctx))
  }
  return { stageLabel, headline, reasoning, urgency, primary: mk(primaryId, ctx), secondary }
}

export function getNextBestPlan(ctx: LeadActionContext): NextBestPlan {
  const name = ctx.firstName || 'this lead'
  const fresh = ctx.hoursSinceCreated !== null && ctx.hoursSinceCreated < 24
  const aging = ctx.hoursSinceCreated !== null && ctx.hoursSinceCreated >= 72
  const budgetGap = ctx.budgetRatio !== null && ctx.budgetRatio < 0.85
  const strongFit = (ctx.matchScore ?? 0) >= 80
  const isGroup = (ctx.groupSize ?? 1) > 1
  const moveInSoon = ctx.moveInMonths !== null && ctx.moveInMonths <= 1.5

  // ── 1. CLOSED ───────────────────────────────────────────────────────────
  if (ctx.status === 'closed') {
    if (ctx.closedReason === 'leased') {
      return plan(ctx, 'Closed · Leased',
        `${name} is leased — now turn one win into the next.`,
        'Happy tenants are your best referral source. Ask early, while the excitement is high.',
        'low', 'ask_referral', ['collect_deposit'])
    }
    if (ctx.closedReason === 'found_another_place' || ctx.closedReason === 'budget_mismatch') {
      return plan(ctx, 'Closed',
        `${name} went elsewhere — keep the door open.`,
        'A gracious goodbye plus a referral ask costs nothing and often pays off. Reopen if anything changes.',
        'low', 'ask_referral', ['reopen_lead'])
    }
    return plan(ctx, 'Closed',
      `${name} is closed.`,
      'No action needed. Reopen them if circumstances change or a new unit opens up.',
      'low', 'reopen_lead', ['ask_referral'])
  }

  // ── 2. OFFER ACCEPTED → CLOSE THE DEAL ──────────────────────────────────
  if (ctx.reservation === 'accepted') {
    return plan(ctx, 'Offer accepted · Closing',
      `${name} accepted your offer — get the lease out today.`,
      'This is the moment deals slip. Collect the deposit and send the lease the same day to lock it in before second-guessing creeps in.',
      'now', 'start_lease',
      ['collect_deposit', isGroup ? 'confirm_occupants' : 'close_leased', 'close_leased'])
  }

  // ── 3. OFFER PENDING → PUSH IT OVER THE LINE ────────────────────────────
  if (ctx.reservation === 'pending') {
    return plan(ctx, 'Offer out · Pending',
      `Your offer to ${name} is live — nudge it before it cools.`,
      'A pending offer with a deadline is your strongest close. A quick call or resend now removes the last bit of hesitation.',
      'today', 'view_offer',
      [ctx.hasPhone ? 'call_now' : 'text_followup', 'text_followup'])
  }

  // ── 4. OFFER EXPIRED → REBUILD URGENCY ──────────────────────────────────
  if (ctx.reservation === 'expired') {
    return plan(ctx, 'Offer expired',
      `${name}’s offer lapsed — send a fresh one.`,
      'Don’t let a dead deadline stall the deal. A new, short-fused offer (plus a heads-up call) restarts momentum.',
      'today', 'new_offer',
      [ctx.hasPhone ? 'call_now' : 'text_followup'])
  }

  // ── 5. UPCOMING TOUR → MAXIMIZE SHOW + CONVERT ──────────────────────────
  if (ctx.hasUpcomingTour) {
    const soon = ctx.tourDaysUntil !== null && ctx.tourDaysUntil <= 2
    if (soon && !ctx.tourReminderSent) {
      return plan(ctx, 'Tour scheduled · Soon',
        `${name}’s tour is ${ctx.tourDaysUntil === 0 ? 'today' : ctx.tourDaysUntil === 1 ? 'tomorrow' : 'in a couple days'} — confirm it.`,
        'A 24-hour reminder is the single biggest lever against no-shows. Send it, then make the unit show-ready.',
        'today', 'send_tour_reminder', ['prep_unit', 'reschedule_tour'])
    }
    return plan(ctx, 'Tour scheduled',
      `${name} is booked to tour — prep to convert, not just to show.`,
      'Have the unit show-ready and a reservation offer ready to go the moment the tour ends. Reminder goes out 24h prior.',
      'soon', ctx.tourReminderSent ? 'prep_unit' : 'send_tour_reminder',
      ['prep_unit', 'reschedule_tour'])
  }

  // ── 6. TOURED, NO OFFER → DECISION MOMENT ───────────────────────────────
  if (ctx.toured) {
    return plan(ctx, 'Toured · Decide',
      `${name} has toured — make your move before the trail goes cold.`,
      'Post-tour interest fades within days. A deadlined reservation offer now is the highest-converting step you can take.',
      'now', 'build_offer',
      [ctx.hasPhone ? 'call_now' : 'text_followup', 'text_followup', budgetGap ? 'discuss_pricing' : 'start_lease'])
  }

  // ── 7. QUALIFIED (pre-screened, not toured) → GET THEM IN ───────────────
  if (ctx.hasPrescreen) {
    const reasoningBits = [`${name} is qualified.`]
    if (strongFit) reasoningBits.push('Strong fit on budget and timing — prioritize them.')
    if (budgetGap) reasoningBits.push('Budget is under asking, so be ready to talk terms.')
    if (moveInSoon) reasoningBits.push('They want to move in soon — speed matters.')
    reasoningBits.push('The next milestone is getting them through the door.')

    const secondary: ActionId[] = ['book_tour_manual']
    if (budgetGap) secondary.push('discuss_pricing')
    if (strongFit) secondary.push('build_offer')
    secondary.push('text_followup')

    return plan(ctx, 'Qualified · Tour next',
      `Invite ${name} to tour — they’ve cleared the pre-screen.`,
      reasoningBits.join(' '),
      moveInSoon || strongFit ? 'today' : 'soon',
      'invite_tour', secondary)
  }

  // ── 8. NO PRE-SCREEN ────────────────────────────────────────────────────
  if (ctx.status === 'new' && fresh) {
    return plan(ctx, 'New lead · Speed wins',
      `Reach ${name} now — the first hour is everything.`,
      'Leads contacted within an hour convert several times better. Call if you can; otherwise get the pre-screen in front of them immediately.',
      'now',
      ctx.hasPhone ? 'call_now' : 'send_prescreen',
      ctx.hasPhone ? ['send_prescreen', 'text_followup', 'mark_contacted'] : ['text_followup', 'copy_prescreen_link', 'mark_contacted'])
  }

  if (aging) {
    return plan(ctx, 'No reply · Switch channels',
      `${name} hasn’t responded — change the channel.`,
      'Another identical email won’t land. A live call or a personal text breaks the silence far more reliably.',
      'today',
      ctx.hasPhone ? 'call_now' : 'text_followup',
      ['text_followup', 'send_prescreen', 'reactivate'])
  }

  if (ctx.status === 'cold') {
    return plan(ctx, 'Cold · Reactivate',
      `${name} has gone quiet — try a warm reactivation.`,
      'A short, low-pressure “still searching?” note is the cheapest way to find out who’s still in the market.',
      'soon', 'reactivate',
      ['text_followup', ctx.hasPhone ? 'call_now' : 'copy_prescreen_link'])
  }

  // contacted / follow_up / engaged, still no pre-screen
  return plan(ctx, 'Awaiting pre-screen',
    `Get ${name} pre-screened — it’s the gate to everything else.`,
    'You can’t qualify budget, timing or fit until the pre-screen is in. Send it now; back it up with a quick personal nudge.',
    'today', 'send_prescreen',
    [ctx.hasPhone ? 'call_now' : 'text_followup', 'copy_prescreen_link', ctx.status === 'new' ? 'mark_contacted' : 'mark_engaged'])
}

// Short tag shown next to each action describing how it's carried out.
export function actionKindTag(kind: ActionKind): string {
  return KIND_FALLBACK[kind]
}
