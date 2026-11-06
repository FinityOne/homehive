// Are these rooms going to be full in time?
//
// Student housing is a deadline market, and that is the fact every generic
// analytics screen misses. A vacancy in March and the same vacancy in July are
// not the same problem: one has a whole leasing season left to solve it, and
// the other has weeks before the entire demand pool has signed somewhere else
// and will not look again until next spring. A landlord staring at "8 views
// this week" has no way to tell which of those two situations they are in, and
// the cost of getting it wrong is a room empty for twelve months rather than
// a price cut taken six weeks earlier.
//
// So this engine answers the only question that matters about a vacancy:
// at the rate inquiries are arriving now, do the open rooms fill before the
// move-in date?
//
// It is arithmetic, not a forecast, and it says so. Three honest inputs:
// rooms open, weeks remaining, and inquiries per week. The fourth — how many
// inquiries it takes to sign one room — is measured from the landlord's own
// history when there is enough of it, and flagged as an assumption when there
// is not. A pace verdict built on an unflagged guess would be the most
// confident wrong number on the page.

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * The platform-wide fallback for inquiries-per-signed-room.
 *
 * Used only when a landlord has too little history of their own, and always
 * surfaced as `assumed: true` so the UI can say so. Student renters contact
 * four or five homes each and sign one, and a meaningful share never reply
 * after the first message — eight inquiries per signed room is the order of
 * magnitude that implies.
 */
export const ASSUMED_INQUIRIES_PER_ROOM = 8

/** Below this many signed rooms of history, the landlord's own ratio is noise. */
export const MIN_LEASES_FOR_RATIO = 3

/**
 * The move-in date student demand collapses around when a listing names none.
 *
 * August is when the academic year starts; a room still open in late July is
 * competing for the students who have not signed anywhere, which is a small
 * and shrinking pool.
 */
export const ACADEMIC_MOVE_IN = { month: 8, day: 1 }

/** Under this many weeks, a vacancy is urgent regardless of the arithmetic. */
const URGENT_WEEKS = 6

// ── Types ────────────────────────────────────────────────────────────────────

export type PaceVerdict = 'on_track' | 'tight' | 'behind' | 'no_vacancy' | 'unknown'

export type LeasingPace = {
  verdict: PaceVerdict
  roomsOpen: number
  /** The date being counted down to, `YYYY-MM-DD`. */
  deadline: string | null
  /** Where that date came from, for the copy to be honest about it. */
  deadlineSource: 'listing' | 'academic_year' | null
  weeksLeft: number | null
  /** Inquiries per week over the measured window. */
  inquiriesPerWeek: number
  /** Inquiries needed per week from here to fill every open room in time. */
  neededPerWeek: number | null
  /** Total inquiries still needed. */
  inquiriesNeeded: number | null
  /** Inquiries expected by the deadline if nothing changes. */
  projectedInquiries: number | null
  inquiriesPerRoom: number
  /** True when `inquiriesPerRoom` is the platform fallback, not this landlord's. */
  assumed: boolean
  /** Weeks of traffic at the current rate to reach `inquiriesNeeded`. */
  weeksToFill: number | null
  headline: string
  detail: string
}

export type PaceInput = {
  now: Date
  roomsOpen: number
  /** The listing's own `available_from`, if it has one. */
  availableFrom?: string | null
  /** Inquiries counted over `windowDays`. */
  inquiries: number
  windowDays: number
  /** The landlord's own history, for the conversion ratio. */
  history?: { inquiries: number; roomsSigned: number }
}

// ── Dates ────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

function phoenixDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/**
 * The next academic move-in date on or after today.
 *
 * On 5 November 2026 that is 1 August 2027; on 2 March 2027 it is still
 * 1 August 2027. A date already past would make every vacancy read as
 * infinitely late.
 */
export function nextAcademicMoveIn(now: Date): string {
  const today = phoenixDay(now)
  const year = Number(today.slice(0, 4))
  const mm = String(ACADEMIC_MOVE_IN.month).padStart(2, '0')
  const dd = String(ACADEMIC_MOVE_IN.day).padStart(2, '0')
  const thisYear = `${year}-${mm}-${dd}`
  return thisYear >= today ? thisYear : `${year + 1}-${mm}-${dd}`
}

function weeksBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`)
  const b = Date.parse(`${toDay}T00:00:00Z`)
  return Math.max(0, (b - a) / DAY_MS / 7)
}

// ── Build ────────────────────────────────────────────────────────────────────

export function buildPace(input: PaceInput): LeasingPace {
  const { now, roomsOpen, inquiries, windowDays, history } = input
  const today = phoenixDay(now)

  // How many inquiries this landlord actually needs per signed room. Their own
  // number beats the platform's whenever they have enough history for it, both
  // because it is true for them and because a landlord who converts well
  // should not be told to chase volume they do not need.
  const measured =
    history && history.roomsSigned >= MIN_LEASES_FOR_RATIO && history.inquiries > 0
      ? history.inquiries / history.roomsSigned
      : null
  const inquiriesPerRoom = Math.max(1, Math.round((measured ?? ASSUMED_INQUIRIES_PER_ROOM) * 10) / 10)
  const assumed = measured == null

  const perWeek = windowDays > 0 ? Math.round((inquiries / windowDays) * 7 * 10) / 10 : 0

  if (roomsOpen <= 0) {
    return {
      verdict: 'no_vacancy', roomsOpen: 0,
      deadline: null, deadlineSource: null, weeksLeft: null,
      inquiriesPerWeek: perWeek, neededPerWeek: null, inquiriesNeeded: null,
      projectedInquiries: null, inquiriesPerRoom, assumed, weeksToFill: null,
      headline: 'Every room is spoken for',
      detail: 'Nothing is vacant, so traffic is now about renewals and your next opening rather than filling anything today.',
    }
  }

  // A listing's own date wins; it is the one the landlord actually committed
  // to. Only when there is none does the academic calendar stand in, and the
  // copy says which it used.
  const listingDate = input.availableFrom && input.availableFrom >= today ? input.availableFrom : null
  const deadline = listingDate ?? nextAcademicMoveIn(now)
  const deadlineSource: LeasingPace['deadlineSource'] = listingDate ? 'listing' : 'academic_year'
  const weeksLeft = Math.round(weeksBetween(today, deadline) * 10) / 10

  const inquiriesNeeded = Math.ceil(roomsOpen * inquiriesPerRoom)
  const projectedInquiries = Math.round(perWeek * weeksLeft)
  const neededPerWeek = weeksLeft > 0 ? Math.round((inquiriesNeeded / weeksLeft) * 10) / 10 : null

  const ratio = inquiriesNeeded > 0 ? projectedInquiries / inquiriesNeeded : 1
  const verdict: PaceVerdict =
    perWeek === 0 ? 'behind'
    : ratio >= 1.2 ? 'on_track'
    : ratio >= 0.8 ? 'tight'
    : 'behind'

  const roomsWord = `${roomsOpen} room${roomsOpen === 1 ? '' : 's'}`
  const rateWord = `${perWeek} inquir${perWeek === 1 ? 'y' : 'ies'} a week`
  const when = deadlineSource === 'listing' ? 'your move-in date' : 'the August move-in'
  const weeksWord = weeksLeft < 1 ? 'less than a week' : `${Math.round(weeksLeft)} weeks`

  /**
   * How long the open rooms take to fill at the current rate.
   *
   * This, rather than a projected total, is what an on-pace landlord should
   * read. Multiplying a healthy weekly rate by a deadline nine months out
   * produces a number like "346 inquiries projected against the 8 you need",
   * which is arithmetically true and reads as a joke — and a figure a landlord
   * laughs at is a figure they stop trusting the rest of the page over.
   */
  const weeksToFill = perWeek > 0 ? Math.round((inquiriesNeeded / perWeek) * 10) / 10 : null
  const fillWord =
    weeksToFill == null ? null
    : weeksToFill < 1 ? 'under a week'
    : weeksToFill < 1.5 ? 'about a week'
    : `about ${Math.round(weeksToFill)} weeks`

  const headline =
    verdict === 'on_track' ? `On pace to fill ${roomsWord}`
    : verdict === 'tight'  ? `Just barely on pace for ${roomsWord}`
    :                        `Behind pace on ${roomsWord}`

  const basis = assumed
    ? `about ${inquiriesPerRoom} inquiries per signed room, the platform average`
    : `your own ${inquiriesPerRoom} inquiries per signed room`

  const detail =
    verdict === 'on_track'
      ? `Filling ${roomsWord} takes roughly ${inquiriesNeeded} inquiries (${basis}). At ${rateWord} that is ${fillWord} of traffic and you have ${weeksWord} until ${when} — comfortable. Answering fast is now worth more than more traffic.`
      : verdict === 'tight'
        ? `${weeksWord} to ${when}. Filling ${roomsWord} takes roughly ${inquiriesNeeded} inquiries (${basis}), and at ${rateWord} you land near ${projectedInquiries} — close enough that one slow fortnight costs you a room. Worth adding reach now rather than cutting rent later.`
        : perWeek === 0
          ? `${weeksWord} to ${when} and no inquiries at all in the last ${windowDays} days. Nothing fills at a rate of zero, and every week spent waiting is a week of the leasing season you do not get back.`
          : `${weeksWord} to ${when}. At ${rateWord} you reach about ${projectedInquiries} against the ~${inquiriesNeeded} you need (${basis}). You need roughly ${neededPerWeek} a week from here — the gap closes with reach or with price, and reach is the cheaper one to try first.`

  const urgent = weeksLeft <= URGENT_WEEKS && verdict !== 'on_track'

  return {
    verdict,
    roomsOpen,
    deadline,
    deadlineSource,
    weeksLeft,
    inquiriesPerWeek: perWeek,
    neededPerWeek,
    inquiriesNeeded,
    projectedInquiries,
    inquiriesPerRoom,
    assumed,
    weeksToFill,
    headline: urgent ? `${headline} — ${weeksWord} left` : headline,
    detail,
  }
}
