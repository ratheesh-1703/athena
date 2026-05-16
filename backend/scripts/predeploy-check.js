const fs = require('fs');
const path = require('path');

const REQUIRED_VARS = [
  'NODE_ENV',
  'PORT',
  'JWT_SECRET',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'FRONTEND_ORIGIN',
  'ENCRYPTION_KEY',
  'SMS_PROVIDER',
];

function parseEnv(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        acc[key] = value;
      }
      return acc;
    }, {});
}

function fail(message) {
  console.error(`x ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok ${message}`);
}

const envPath = path.resolve(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  fail(`Missing .env file at ${envPath}`);
  process.exit(1);
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));

for (const key of REQUIRED_VARS) {
  if (!env[key]) {
    fail(`Missing required value: ${key}`);
  }
}

if ((env.NODE_ENV || '').toLowerCase() !== 'production') {
  fail('NODE_ENV must be production for deployment checks');
}

if (env.FRONTEND_ORIGIN === '*') {
  fail('FRONTEND_ORIGIN cannot be * in production');
}

if ((env.ENCRYPTION_KEY || '').length < 32) {
  fail('ENCRYPTION_KEY must be at least 32 characters');
}

if ((env.SMS_PROVIDER || '').toLowerCase() === 'console') {
  fail('SMS_PROVIDER cannot be console in production');
}

if ((env.DB_SSL || '').toLowerCase() === 'true' || env.DB_SSL === '1') {
  ok('DB SSL is enabled');
} else {
  ok('DB SSL is disabled (enable DB_SSL=true when using managed/cloud MySQL)');
}

if (process.exitCode) {
  console.error('\nPredeploy checks failed. Fix the issues above before deploying.');
  process.exit(process.exitCode);
}

ok('Predeploy checks passed.');
