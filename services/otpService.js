const otpStore = new Map()
const OTP_TTL_MS = 10 * 60 * 1000

export function createOtp(email, purpose) {
  const key = email.toLowerCase().trim()
  const code = String(Math.floor(100000 + Math.random() * 900000))
  otpStore.set(key, {
    code,
    purpose,
    expires: Date.now() + OTP_TTL_MS,
    attempts: 0,
  })
  return code
}

export function verifyOtp(email, code, purpose) {
  const key = email.toLowerCase().trim()
  const entry = otpStore.get(key)
  if (!entry) return { ok: false, error: 'No OTP found. Request a new code.' }
  if (Date.now() > entry.expires) {
    otpStore.delete(key)
    return { ok: false, error: 'OTP expired. Request a new code.' }
  }
  if (entry.purpose !== purpose) {
    return { ok: false, error: 'Invalid OTP type.' }
  }
  entry.attempts += 1
  if (entry.attempts > 5) {
    otpStore.delete(key)
    return { ok: false, error: 'Too many attempts. Request a new code.' }
  }
  if (String(code).trim() !== entry.code) {
    return { ok: false, error: 'Incorrect OTP.' }
  }
  otpStore.delete(key)
  return { ok: true }
}

export function clearOtp(email) {
  otpStore.delete(email.toLowerCase().trim())
}
