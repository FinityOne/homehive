// Builder for the co-signer welcome / "you've been added" email. Sent once when
// a landlord adds a co-signer to an applicant's screening. Mirrors the HomeHive
// transactional email look used by the reference + review emails.

export type CosignerWelcomeInput = {
  cosignerFirstName: string | null
  applicantName: string
  propertyAddress: string | null
  landlordName: string
  landlordEmail: string
}

export type BuiltCosignerEmail = { subject: string; html: string; replyTo: string }

export function buildCosignerWelcomeEmail(input: CosignerWelcomeInput): BuiltCosignerEmail {
  const { cosignerFirstName, applicantName, propertyAddress, landlordName, landlordEmail } = input
  const greeting = cosignerFirstName ? `Hi ${cosignerFirstName},` : 'Hi there,'
  const place = propertyAddress ? ` for <strong>${propertyAddress}</strong>` : ''
  const subject = `You've been added to HomeHive as a co-signer for ${applicantName}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>You've been added as a co-signer</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.45);font-weight:600;text-transform:uppercase;letter-spacing:1px;">Co-signer Invitation</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:32px 28px;">

    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#1a1a1a;">${greeting}</p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      <strong>${landlordName}</strong> has added you to <strong>HomeHive</strong> as a <strong>co-signer</strong> (guarantor) on <strong>${applicantName}</strong>'s rental application${place}. 🎉
    </p>

    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:12px;padding:18px 20px;margin:0 0 22px;">
      <div style="font-size:12px;font-weight:700;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">What this means</div>
      <div style="font-size:14px;line-height:1.7;color:#3a3a3a;">
        As a co-signer, you agree to back the lease if ${applicantName} is ever unable to pay. To complete this, ${landlordName} will run a quick screening on your behalf — typically a credit, criminal, and eviction check, plus income verification.
      </div>
    </div>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      <strong>What to expect next:</strong> you may receive a short verification form by email (for your employer or a previous landlord), or ${landlordName} may reach out directly for any documents needed. There's nothing you need to do right now.
    </p>

    <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#6b6b6b;">
      Questions? Just <strong>reply to this email</strong> — it goes straight to ${landlordName}.
    </p>

    <div style="border-top:1px solid #f0ede6;padding-top:20px;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1a1a1a;">${landlordName}</p>
      <p style="margin:0;font-size:13px;color:#6b6b6b;">Property Owner · <a href="mailto:${landlordEmail}" style="color:#8C1D40;text-decoration:none;">${landlordEmail}</a></p>
      <p style="margin:6px 0 0;font-size:12px;color:#9b9b9b;">Sent via <a href="https://homehive.live" style="color:#8C1D40;text-decoration:none;">HomeHive</a></p>
    </div>

  </div>

  <div style="margin-top:20px;text-align:center;font-size:11px;color:#9b9b9b;line-height:1.7;">
    You're receiving this because you were listed as a co-signer on a rental application managed on HomeHive.<br/>
    If this was unexpected, please reply to let ${landlordName} know.
  </div>
</div>
</body>
</html>`

  return { subject, html, replyTo: landlordEmail }
}
