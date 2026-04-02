const bcrypt = require('bcryptjs');

function normalizePhone(phone) {
  return String(phone || '').trim();
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpSms({ phone, otp }) {
  const provider = String(process.env.SMS_PROVIDER || 'console').toLowerCase();

  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;

    if (!accountSid || !authToken || !from) {
      throw new Error('Twilio SMS provider is selected but TWILIO_* env vars are missing');
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: phone,
      From: from,
      Body: `Your ATHENA OTP is ${otp}. It expires in 5 minutes.`,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Twilio SMS failed: ${response.status} ${text}`);
    }

    return { provider: 'twilio' };
  }

  // Default: console provider (safe for dev)
  console.log(`[ATHENA OTP] phone=${phone} otp=${otp}`);
  return { provider: 'console' };
}

async function createOtpVerificationRecord(db, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    throw new Error('phone is required');
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await db.query('DELETE FROM otp_verifications WHERE phone = ?', [phone]);
  await db.query(
    `INSERT INTO otp_verifications (phone, otp_code, otp_hash, expires_at, last_sent_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [phone, otp, otpHash, expiresAt]
  );

  await sendOtpSms({ phone, otp });

  return {
    phone,
    otpPreview: process.env.NODE_ENV !== 'production' && String(process.env.SMS_PROVIDER || 'console').toLowerCase() === 'console'
      ? otp
      : undefined,
  };
}

async function verifyOtpCode(db, rawPhone, rawOtp) {
  const phone = normalizePhone(rawPhone);
  const otp = String(rawOtp || '').trim();

  if (!phone || !otp) {
    return { ok: false, reason: 'phone and otp are required', status: 400 };
  }

  const [rows] = await db.query(
    `SELECT id, otp_code, otp_hash, expires_at, attempts, verified_at
     FROM otp_verifications
     WHERE phone = ?
     ORDER BY id DESC
     LIMIT 1`,
    [phone]
  );

  if (!rows.length) {
    return { ok: false, reason: 'OTP not found. Request a new OTP.', status: 404 };
  }

  const otpRow = rows[0];
  if (otpRow.verified_at) {
    return { ok: false, reason: 'OTP already verified. Request a new OTP if needed.', status: 409 };
  }

  if (new Date(otpRow.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'OTP expired. Request a new OTP.', status: 410 };
  }

  if (Number(otpRow.attempts || 0) >= 5) {
    return { ok: false, reason: 'Too many OTP attempts. Request a new OTP.', status: 429 };
  }

  let match = false;
  if (otpRow.otp_hash) {
    match = await bcrypt.compare(otp, otpRow.otp_hash);
  } else {
    // fallback for older rows
    match = String(otpRow.otp_code) === otp;
  }

  if (!match) {
    await db.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?', [otpRow.id]);
    return { ok: false, reason: 'Invalid OTP', status: 401 };
  }

  await db.query('UPDATE otp_verifications SET verified_at = NOW() WHERE id = ?', [otpRow.id]);
  return { ok: true };
}

module.exports = {
  createOtpVerificationRecord,
  verifyOtpCode,
};
