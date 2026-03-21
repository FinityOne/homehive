import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(req: Request) {
  const body = await req.json()

  console.log('Incoming lead:', JSON.stringify(body, null, 2))
  console.log('Resend key prefix:', process.env.RESEND_API_KEY?.slice(0, 8))
  console.log('Sending notification to:', process.env.YOUR_EMAIL)

  // 1. Save to Supabase
  const { error } = await supabase.from('leads').insert([body])
  if (error) {
    console.error('Supabase error:', error)
    return Response.json({ error: 'Failed to save lead' }, { status: 500 })
  }

  console.log('Lead saved to Supabase successfully')

  // 2. Notify you
  try {
    const notifyResult = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: process.env.YOUR_EMAIL!,
      subject: `New lead: ${body.first_name} ${body.last_name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a; margin-bottom: 4px;">New HomeHive Lead</h2>
          <p style="color: #9b9b9b; margin-bottom: 24px; font-size: 14px;">Submitted just now</p>
          <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #6b6b6b; width: 140px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${body.first_name} ${body.last_name}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Email</td><td style="padding: 8px 0;">${body.email}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Phone</td><td style="padding: 8px 0;">${body.phone || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Property</td><td style="padding: 8px 0;">${body.property || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Move-in</td><td style="padding: 8px 0;">${body.move_in_date || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Budget</td><td style="padding: 8px 0;">${body.budget || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Roommate</td><td style="padding: 8px 0;">${body.roommate_preference || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Lifestyle</td><td style="padding: 8px 0;">${body.lifestyle || '—'}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b6b6b;">Notes</td><td style="padding: 8px 0;">${body.notes || '—'}</td></tr>
          </table>
          <div style="margin-top: 24px; padding: 16px; background: #f5f4f0; border-radius: 8px; font-size: 13px; color: #6b6b6b;">
            Reply to this lead at <a href="mailto:${body.email}">${body.email}</a>
          </div>
        </div>
      `,
    })
    console.log('Notification email result:', JSON.stringify(notifyResult, null, 2))
  } catch (emailError) {
    console.error('Notification email error:', emailError)
  }

  // 3. Confirmation to the lead
  try {
    const confirmResult = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: body.email,
      subject: `${body.first_name}, we got your interest! 🏠`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a;">Hey ${body.first_name}, you're on the list!</h2>
          <p style="color: #3a3a3a; line-height: 1.7; font-size: 15px;">
            Thanks for your interest in <strong>${body.property || 'the home'}</strong>.
            We'll be in touch within a few hours to answer questions and set up a tour if it's a great fit.
          </p>
          <p style="color: #3a3a3a; line-height: 1.7; font-size: 15px;">
            Have questions in the meantime? Just reply to this email.
          </p>
          <div style="margin-top: 28px; padding: 16px; background: #f5f4f0; border-radius: 8px;">
            <p style="margin: 0; font-size: 13px; color: #6b6b6b;">
              <strong style="color: #1a1a1a;">What happens next?</strong><br/>
              We'll review your info, check availability for your move-in date, and reach out to confirm details and schedule a tour.
            </p>
          </div>
          <p style="margin-top: 24px; font-size: 13px; color: #9b9b9b;">— The HomeHive Team · Tempe, AZ</p>
        </div>
      `,
    })
    console.log('Confirmation email result:', JSON.stringify(confirmResult, null, 2))
  } catch (emailError) {
    console.error('Confirmation email error:', emailError)
  }

  return Response.json({ success: true })
}
