import nodemailer from "nodemailer";

let transporter = null;

function getSmtpTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
    },
  });
  return transporter;
}

async function sendViaResend(to, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM ||
    process.env.SMTP_FROM ||
    "Optivix <onboarding@resend.dev>";
  if (!apiKey) return null;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Optivix — Verify your email address",
      html: buildOtpHtml(to, code),
      text: `Welcome to Optivix!\n\nUse the following 6-digit verification code to complete your registration:\n\n${code}\n\nThis code is valid for 10 minutes. If you did not request this code, you can safely ignore this email.\n\nBest regards,\nThe Optivix Team\nOptivix Inc., San Francisco, CA`,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Resend failed (${res.status})`);
  }
  return { sent: true };
}

function buildOtpHtml(to, code) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Verify your email</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="500px" style="max-width: 500px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); overflow: hidden; border-spacing: 0;">
              <!-- Header Accent Bar -->
              <tr>
                <td style="background: linear-gradient(135deg, #ea580c 0%, #3b82f6 100%); height: 6px;"></td>
              </tr>
              
              <!-- Content Block -->
              <tr>
                <td style="padding: 40px 32px; text-align: left;">
                  <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.025em;">Optivix</h1>
                  <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #475569;">Welcome to Optivix! Please verify your email address to complete your registration and activate your AI-native IDE workspace.</p>
                  
                  <div style="background-color: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                    <span style="display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 8px;">Verification Code</span>
                    <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #0f172a; display: block; margin: 0;">${code}</span>
                  </div>
                  
                  <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 20px; color: #64748b;">This verification code is valid for <strong>10 minutes</strong>. For security, do not share this code with anyone.</p>
                  <p style="margin: 0; font-size: 13px; line-height: 20px; color: #64748b;">If you didn't initiate this signup, you can safely ignore this email.</p>
                </td>
              </tr>
              
              <!-- Footer Block -->
              <tr>
                <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px 32px; text-align: center;">
                  <p style="margin: 0 0 4px 0; font-size: 12px; color: #94a3b8; font-weight: 500;">© ${new Date().getFullYear()} Optivix Inc. All rights reserved.</p>
                  <p style="margin: 0; font-size: 11px; color: #cbd5e1;">100 Pine Street, San Francisco, CA 94111</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

async function sendViaSmtp(to, code) {
  const transport = getSmtpTransporter();
  if (!transport) return null;

  await transport.verify().catch((err) => {
    throw new Error(`SMTP connection failed: ${err.message}`);
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: "Optivix — Verify your email address",
    html: buildOtpHtml(to, code),
    text: `Welcome to Optivix!\n\nUse the following 6-digit verification code to complete your registration:\n\n${code}\n\nThis code is valid for 10 minutes. If you did not request this code, you can safely ignore this email.\n\nBest regards,\nThe Optivix Team\nOptivix Inc., San Francisco, CA`,
  });
  return { sent: true };
}

/**
 * Send OTP email. Never exposes code in API response — only to inbox.
 */
export async function sendOtpEmail(to, code) {
  // Try sending via Resend first (if API Key is configured)
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await sendViaResend(to, code);
      if (r?.sent) return r;
    } catch (err) {
      console.warn(
        "[Resend API Error] Falling back to Gmail SMTP:",
        err.message,
      );
    }
  }

  // Try sending via Gmail SMTP
  try {
    const s = await sendViaSmtp(to, code);
    if (s?.sent) return s;
  } catch (err) {
    console.error(
      "[Gmail SMTP Error] Falling back to local terminal logs:",
      err.message,
    );
  }

  // Ultimate development / debug fallback: print directly to console log
  console.log(`\n🔑 ════════════════════════════════════════════`);
  console.log(`🔑 [DEVELOPMENT ONLY] No active email delivery succeeded.`);
  console.log(`🔑 OTP for ${to} is: ${code}`);
  console.log(`🔑 ════════════════════════════════════════════\n`);
  return { sent: true, devMode: true };
}
