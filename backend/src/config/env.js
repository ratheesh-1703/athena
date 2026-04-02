function requireEnv(name, { allowInDev = true } = {}) {
  const value = process.env[name];
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (!value && (allowInDev ? isProd : true)) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function validateEnv() {
  // Always required
  requireEnv('JWT_SECRET', { allowInDev: false });

  // Strongly recommended in production
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProd) {
    requireEnv('DB_HOST', { allowInDev: false });
    requireEnv('DB_USER', { allowInDev: false });
    requireEnv('DB_NAME', { allowInDev: false });

    const encryptionKey = requireEnv('ENCRYPTION_KEY', { allowInDev: false });
    if (String(encryptionKey).length < 32) {
      throw new Error('ENCRYPTION_KEY must be at least 32 characters in production');
    }

    const origin = process.env.FRONTEND_ORIGIN;
    if (!origin || origin === '*') {
      throw new Error('FRONTEND_ORIGIN must be set (not "*") in production');
    }

    const smsProvider = String(process.env.SMS_PROVIDER || 'console').toLowerCase();
    if (smsProvider === 'console') {
      throw new Error('SMS_PROVIDER=console is not allowed in production. Configure a real SMS provider.');
    }
  }
}

module.exports = { validateEnv };
