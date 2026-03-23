import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

// Anon key is fine here — RLS policy allows public inserts on leads
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(req: Request) {
  const body = await req.json()
  const { first_name, email, phone, move_in_date, property } = body

  console.log('Incoming lead:', JSON.stringify({ first_name, email, phone, move_in_date, property }, null, 2))
  console.log('Resend key prefix:', process.env.RESEND_API_KEY?.slice(0, 8))
  console.log('Sending notification to:', process.env.YOUR_EMAIL)

  // 1. Save to Supabase and get back the new lead ID
  const { data, error } = await supabase
    .from('leads')
    .insert([{ first_name, email, phone, move_in_date, property, status: 'new' }])
    .select()

  if (error || !data || data.length === 0) {
    console.error('Supabase error:', error)
    return Response.json({ error: 'Failed to save lead' }, { status: 500 })
  }

  const leadId = data[0].id
  console.log('Lead saved to Supabase. ID:', leadId)

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const prescreenUrl = `${siteUrl}/pre-screen/${leadId}`

  // 2. Notify admin
  try {
    const notifyResult = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: process.env.YOUR_EMAIL!,
      subject: `New lead: ${first_name} — ${property || 'unknown property'}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a; margin-bottom: 4px;">New HomeHive Lead</h2>
          <p style="color: #9b9b9b; margin-bottom: 24px; font-size: 14px;">Submitted just now</p>
          <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #6b6b6b; width: 140px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${first_name}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Email</td><td style="padding: 8px 0;">${email}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Phone</td><td style="padding: 8px 0;">${phone || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Property</td><td style="padding: 8px 0;">${property || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Move-in</td><td style="padding: 8px 0;">${move_in_date || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Lead ID</td><td style="padding: 8px 0; font-size: 12px; color: #9b9b9b;">${leadId}</td></tr>
          </table>
          <div style="margin-top: 24px; padding: 16px; background: #f5f4f0; border-radius: 8px; font-size: 13px; color: #6b6b6b;">
            Reply to this lead at <a href="mailto:${email}">${email}</a>
          </div>
          <div style="margin-top: 12px; padding: 12px 16px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); border-radius: 8px; font-size: 13px; color: #065f46;">
            Pre-screen link sent to lead: <a href="${prescreenUrl}" style="color: #10b981;">${prescreenUrl}</a>
          </div>
        </div>
      `,
    })
    console.log('Admin notification email result:', JSON.stringify(notifyResult, null, 2))
  } catch (emailError) {
    console.error('Admin notification email error:', emailError)
  }

  // 3. Send lead welcome email with pre-screen link
  try {
    const welcomeResult = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: email,
      subject: 'Complete your HomeHive application — one quick step',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          </head>
          <body style="margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <div style="max-width: 540px; margin: 0 auto; padding: 40px 24px;">

              <!-- Header -->
              <div style="margin-bottom: 32px;">
                <div style="font-size: 22px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px;">
                  Home<span style="color: #10b981; font-style: italic;">Hive</span>
                </div>
              </div>

              <!-- Card -->
              <div style="background: #ffffff; border-radius: 16px; padding: 36px 32px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">

                <p style="margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #0f172a;">
                  Hi ${first_name},
                </p>

                <p style="margin: 0 0 20px; font-size: 15px; color: #475569; line-height: 1.7;">
                  Thanks for your interest in <strong style="color: #0f172a;">${property || 'the property'}</strong>!
                  We received your info and we're already reviewing availability for you.
                </p>

                <div style="background: rgba(16,185,129,0.07); border: 1px solid rgba(16,185,129,0.2); border-radius: 10px; padding: 16px 20px; margin-bottom: 24px;">
                  <p style="margin: 0; font-size: 14px; color: #065f46; font-weight: 500; line-height: 1.6;">
                    <strong style="color: #10b981;">Move to the front of the line.</strong><br/>
                    To hold your spot, take 2 minutes to complete your profile.
                    Landlords prioritize applications with complete profiles.
                  </p>
                </div>

                <!-- CTA Button -->
                <div style="text-align: center; margin: 28px 0;">
                  <a
                    href="${prescreenUrl}"
                    style="
                      display: inline-block;
                      background: #10b981;
                      color: #ffffff;
                      text-decoration: none;
                      font-size: 15px;
                      font-weight: 600;
                      padding: 14px 32px;
                      border-radius: 10px;
                      letter-spacing: -0.1px;
                    "
                  >
                    Complete My Profile →
                  </a>
                </div>

                <p style="margin: 20px 0 0; font-size: 13px; color: #94a3b8; text-align: center; line-height: 1.6;">
                  This link is personal to you and expires in 7 days.
                </p>

              </div>

              <!-- Footer -->
              <div style="margin-top: 28px; text-align: center; font-size: 12px; color: #94a3b8;">
                HomeHive Team · <a href="mailto:hello@homehive.live" style="color: #10b981; text-decoration: none;">hello@homehive.live</a>
              </div>

            </div>
          </body>
        </html>
      `,
    })
    console.log('Welcome email result:', JSON.stringify(welcomeResult, null, 2))
  } catch (emailError) {
    console.error('Welcome email error:', emailError)
  }

  return Response.json({ success: true, leadId })
}
