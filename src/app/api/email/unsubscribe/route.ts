/**
 * GET|POST /api/email/unsubscribe?email=&c=&t=
 *
 * Takes someone off a non-transactional email category, from inside their mail
 * client, with no session.
 *
 * Both verbs do the same thing, deliberately:
 *   • GET  — the link a person clicks. Answers with a page, not JSON.
 *   • POST — what Gmail and Outlook call themselves when the message carries
 *     `List-Unsubscribe-Post`. Nobody sees the response, so it is terse.
 *
 * Unsubscribing on a GET is normally a mistake — a prefetching mail client can
 * fire it without the person meaning to. Here that is the *desired* failure
 * mode: the cost of an accidental unsubscribe is that we stop marketing to
 * someone, and the cost of making them click twice is a spam complaint. So it
 * is one click, and the confirmation page offers the way back.
 *
 * The signature is the authorisation (see `unsubscribeToken.ts`); without a
 * valid one, nothing is written.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { verifyUnsubscribe } from '@/lib/unsubscribeToken'
import { getSiteUrl } from '@/lib/siteUrl'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/** Categories a link may unsubscribe from. Transactional mail is not on this list and never will be. */
const ALLOWED = new Set(['landlord_activation'])

const LABELS: Record<string, string> = {
  landlord_activation: 'emails about getting your property listed',
}

type Outcome = 'done' | 'invalid' | 'error'

async function apply(req: NextRequest): Promise<{ outcome: Outcome; email: string; category: string }> {
  const q = new URL(req.url).searchParams
  const email = (q.get('email') ?? '').trim().toLowerCase()
  const category = (q.get('c') ?? '').trim()
  const token = q.get('t') ?? ''

  if (!email || !ALLOWED.has(category) || !verifyUnsubscribe(email, category, token)) {
    return { outcome: 'invalid', email, category }
  }

  // Upsert, not insert: clicking the link in two different emails is one
  // decision, and the second click must not 409.
  const { error } = await supabaseAdmin
    .from('email_opt_outs')
    .upsert(
      { email, category, source: 'email_link', unsubscribed_at: new Date().toISOString() },
      { onConflict: 'email,category' },
    )

  if (error) {
    console.error('[unsubscribe] could not record opt-out', email, category, error)
    return { outcome: 'error', email, category }
  }

  console.log('[unsubscribe] opted out', email, category)
  return { outcome: 'done', email, category }
}

export async function POST(req: NextRequest) {
  const { outcome } = await apply(req)
  // One-click unsubscribe wants a 2xx and nothing else. A 4xx here makes some
  // clients show the recipient an error for something they did correctly.
  return new Response(outcome === 'done' ? 'Unsubscribed' : 'OK', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

export async function GET(req: NextRequest) {
  const { outcome, email, category } = await apply(req)
  const site = getSiteUrl()
  const what = LABELS[category] ?? 'these emails'

  const body =
    outcome === 'done'
      ? {
          title: 'You\'re unsubscribed',
          lede: `We won't send you ${what} again.`,
          detail:
            'Anything to do with an actual tenancy — rent receipts, lease documents, maintenance, messages from a tenant — is unaffected and will still reach you.',
          tone: '#16a34a',
        }
      : outcome === 'error'
      ? {
          title: 'Something went wrong',
          lede: 'We could not record that just now.',
          detail: 'Please try the link again in a minute, or reply to any of our emails and we will take you off the list by hand.',
          tone: '#9f1239',
        }
      : {
          title: 'This link isn\'t valid',
          lede: 'We could not verify that unsubscribe link.',
          detail: 'It may have been altered in transit. Reply to any email from us and we will take you off the list by hand.',
          tone: '#9f1239',
        }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(body.title)} — HomeHive</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #faf9f6; color: #1a1a1a; min-height: 100vh; display: flex;
         align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; padding: 36px 32px;
          max-width: 460px; width: 100%; }
  .bar { height: 4px; border-radius: 4px; background: ${body.tone}; width: 46px; margin-bottom: 20px; }
  h1 { font-size: 21px; font-weight: 800; letter-spacing: -0.4px; margin-bottom: 10px; }
  .lede { font-size: 14.5px; color: #3a3a3a; line-height: 1.6; margin-bottom: 14px; }
  .detail { font-size: 13px; color: #6a6a6a; line-height: 1.65; margin-bottom: 24px; }
  .addr { font-weight: 600; color: #1a1a1a; }
  a.btn { display: inline-block; background: linear-gradient(135deg,#6c002a,#8c1d40); color: #fff;
          text-decoration: none; font-size: 13.5px; font-weight: 700; padding: 12px 26px;
          border-radius: 9px; }
  .back { margin-top: 16px; font-size: 12.5px; color: #9b9b9b; line-height: 1.6; }
  .back a { color: #6a6a6a; }
  @media (prefers-color-scheme: dark) {
    body { background: #141414; color: #f5f5f5; }
    .card { background: #1d1d1d; border-color: #2e2e2e; }
    .lede { color: #d4d4d4; } .detail, .back { color: #9b9b9b; }
    .addr { color: #f5f5f5; }
  }
</style></head>
<body>
  <div class="card">
    <div class="bar"></div>
    <h1>${esc(body.title)}</h1>
    <p class="lede">${esc(body.lede)}${email ? ` <span class="addr">${esc(email)}</span>` : ''}</p>
    <p class="detail">${esc(body.detail)}</p>
    <a class="btn" href="${esc(site)}/homes">Go to HomeHive</a>
    ${outcome === 'done'
      ? `<p class="back">Changed your mind? <a href="${esc(site)}/landlord/subscribe">List a property</a> any time — that works whether or not you're subscribed.</p>`
      : ''}
  </div>
</body></html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
