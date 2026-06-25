// Shared builders for background-check reference verification emails.
// Used by both the preview endpoint and the send endpoint so what a landlord
// previews is byte-for-byte what gets sent.

export type RefEmailType = 'employer' | 'residence'

export type ReferenceEmailInput = {
  type: RefEmailType
  leadName: string
  // employer
  landlordName: string
  landlordEmail: string
  employerName: string | null
  managerName: string | null
  // residence
  contactName: string | null
  propertyAddress: string | null
  formUrl: string
}

export type BuiltEmail = { subject: string; html: string; replyTo: string }

export function buildReferenceEmail(input: ReferenceEmailInput): BuiltEmail {
  const isEmployer = input.type === 'employer'
  const subject = isEmployer
    ? `Employment Verification Request — ${input.leadName}`
    : `Rental Reference Request — ${input.leadName}`

  const html = isEmployer
    ? employerEmailHtml({
        landlordName: input.landlordName,
        landlordEmail: input.landlordEmail,
        leadName: input.leadName,
        employerName: input.employerName,
        managerName: input.managerName,
        formUrl: input.formUrl,
      })
    : residenceEmailHtml({
        leadName: input.leadName,
        contactName: input.contactName,
        propertyAddress: input.propertyAddress,
        formUrl: input.formUrl,
      })

  // We don't receive inbound email, so any reply must reach the landlord
  // directly rather than the unmonitored hello@homehive.live inbox.
  const replyTo = input.landlordEmail
  return { subject, html, replyTo }
}

export function employerEmailHtml(params: {
  landlordName: string
  landlordEmail: string
  leadName: string
  employerName: string | null
  managerName: string | null
  formUrl: string
}): string {
  const { landlordName, landlordEmail, leadName, employerName, managerName, formUrl } = params
  const greeting = managerName ? `Hi ${managerName},` : employerName ? `To the team at ${employerName},` : 'To Whom It May Concern,'
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Employment Verification Request</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.45);font-weight:600;text-transform:uppercase;letter-spacing:1px;">Employment Verification</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:32px 28px;">

    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#1a1a1a;">${greeting}</p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      My name is <strong>${landlordName}</strong> and I'm an independent property owner. <strong>${leadName}</strong> has applied to rent one of my residential properties and has listed your organization as their current employer.
    </p>

    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      As part of a standard screening process, I'd be grateful if you could verify a few quick details. The fastest way is the secure form below — it takes about 2 minutes and your answers are completely confidential.
    </p>

    <div style="text-align:center;margin-bottom:24px;">
      <a href="${formUrl}" style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:-0.2px;">
        Complete Verification Form →
      </a>
      <p style="margin:12px 0 0;font-size:12px;color:#9b9b9b;">Takes about 2 minutes · Confidential</p>
    </div>

    <p style="margin:0 0 4px;font-size:13px;color:#9b9b9b;">Or copy and paste this link into your browser:</p>
    <p style="margin:0 0 24px;font-size:12px;color:#8C1D40;word-break:break-all;">${formUrl}</p>

    <div style="background:#faf9f6;border-left:3px solid #8C1D40;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.5px;">What we're confirming</p>
      <ol style="margin:0;padding-left:18px;font-size:14px;line-height:2;color:#3a3a3a;">
        <li>Is <strong>${leadName}</strong> currently employed at your organization?</li>
        <li>What is their job title and approximate start date?</li>
        <li>Is their position full-time, part-time, or contract?</li>
        <li>Can you provide or confirm their approximate gross monthly income?</li>
        <li>Is their employment in good standing with no pending termination?</li>
        <li>Are there any active wage garnishments or liens on their wages?</li>
      </ol>
    </div>

    <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#6b6b6b;">
      Prefer email? You can simply <strong>reply to this message</strong> — your response will go directly to ${landlordName}. Thank you for your time, I truly appreciate it.
    </p>

    <div style="border-top:1px solid #f0ede6;padding-top:20px;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1a1a1a;">${landlordName}</p>
      <p style="margin:0;font-size:13px;color:#6b6b6b;">Property Owner · <a href="mailto:${landlordEmail}" style="color:#8C1D40;text-decoration:none;">${landlordEmail}</a></p>
      <p style="margin:6px 0 0;font-size:12px;color:#9b9b9b;">Verified landlord on <a href="https://homehive.live" style="color:#8C1D40;text-decoration:none;">HomeHive</a></p>
    </div>

  </div>

  <div style="margin-top:20px;text-align:center;font-size:11px;color:#9b9b9b;line-height:1.7;">
    This is a confidential verification request sent via HomeHive.<br/>
    If this was unexpected, please disregard this email.
  </div>
</div>
</body>
</html>`
}

export function residenceEmailHtml(params: {
  leadName: string
  contactName: string | null
  propertyAddress: string | null
  formUrl: string
}): string {
  const { leadName, contactName, propertyAddress, formUrl } = params
  const greeting = contactName ? `Hi ${contactName},` : 'Hi there,'
  const addrLine = propertyAddress ? ` at <strong>${propertyAddress}</strong>` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Rental Reference Request</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.45);font-weight:600;text-transform:uppercase;letter-spacing:1px;">Rental Reference Request</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:32px 28px;">

    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#1a1a1a;">${greeting}</p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      <strong>${leadName}</strong> has applied to rent a property managed by our team and has listed your property${addrLine} as a previous residence, with you as their reference.
    </p>

    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      We'd appreciate a few minutes of your time to complete a short reference form. It's quick, straightforward, and your responses are completely confidential.
    </p>

    <div style="text-align:center;margin-bottom:28px;">
      <a href="${formUrl}" style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:-0.2px;">
        Complete Reference Form →
      </a>
      <p style="margin:12px 0 0;font-size:12px;color:#9b9b9b;">Takes about 3–5 minutes</p>
    </div>

    <p style="margin:0 0 4px;font-size:13px;color:#9b9b9b;">Or copy and paste this link into your browser:</p>
    <p style="margin:0 0 28px;font-size:12px;color:#8C1D40;word-break:break-all;">${formUrl}</p>

    <div style="border-top:1px solid #f0ede6;padding-top:20px;">
      <p style="margin:0;font-size:12px;color:#9b9b9b;">Questions? Reach us at <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a></p>
      <p style="margin:6px 0 0;font-size:12px;color:#9b9b9b;">Sent via <a href="https://homehive.live" style="color:#8C1D40;text-decoration:none;">HomeHive</a> — property management platform</p>
    </div>

  </div>

  <div style="margin-top:20px;text-align:center;font-size:11px;color:#9b9b9b;line-height:1.7;">
    This is a confidential reference request sent via HomeHive.<br/>
    If this was unexpected, please disregard this email.
  </div>
</div>
</body>
</html>`
}
