import nodemailer from 'nodemailer'

let transporter = null

function getSmtpTransporter() {
  if (transporter) return transporter
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })
  return transporter
}

async function sendViaResend(to, code) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM || process.env.SMTP_FROM || 'Optivix <onboarding@resend.dev>'
  if (!apiKey) return null

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Optivix — Verify your email (sign up)',
      html: buildOtpHtml(to, code),
      text: `Your Optivix verification code is ${code}. Valid for 10 minutes.`,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Resend failed (${res.status})`)
  }
  return { sent: true }
}

function buildOtpHtml(to, code) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#5b9cf5">Optivix</h2>
      <p>Confirm your email <strong>${to}</strong> to create your account:</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:8px;color:#0f172a">${code}</p>
      <p style="color:#64748b;font-size:14px">Valid for 10 minutes. Do not share this code.</p>
    </div>
  `
}

async function sendViaSmtp(to, code) {
  const transport = getSmtpTransporter()
  if (!transport) return null

  await transport.verify().catch((err) => {
    throw new Error(`SMTP connection failed: ${err.message}`)
  })

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Optivix — Verify your email (sign up)',
    html: buildOtpHtml(to, code),
    text: `Your Optivix verification code is ${code}. Valid for 10 minutes.`,
  })
  return { sent: true }
}

/**
 * Send OTP email. Never exposes code in API response — only to inbox.
 */
export async function sendOtpEmail(to, code) {
  try {
    if (process.env.RESEND_API_KEY) {
      const r = await sendViaResend(to, code)
      if (r?.sent) return r
    }
    const s = await sendViaSmtp(to, code)
    if (s?.sent) return s
  } catch (err) {
    console.error('[OTP email error]', err.message)
    throw new Error(
      err.message?.includes('SMTP')
        ? err.message
        : 'Email send failed. Check SMTP/Resend settings in backend .env'
    )
  }

  console.error('[OTP] No email provider configured. Set RESEND_API_KEY or SMTP_* in Optivix_backend/.env')
  throw new Error(
    'Email service not configured. Add RESEND_API_KEY or SMTP_HOST, SMTP_USER, SMTP_PASS in backend .env'
  )
}
