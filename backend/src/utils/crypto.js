const crypto = require('crypto');

function normalizeKey(key) {
  const fallback = 'athena_default_key_change_immediately';
  const source = (key || fallback).padEnd(32, '0').slice(0, 32);
  return Buffer.from(source, 'utf8');
}

function encryptText(plainText) {
  if (!plainText) {
    return null;
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', normalizeKey(process.env.ENCRYPTION_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

module.exports = { encryptText };
