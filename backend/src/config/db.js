const mysql = require('mysql2/promise');

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function buildSslConfig() {
  if (!parseBool(process.env.DB_SSL, false)) {
    return undefined;
  }

  const caRaw = process.env.DB_SSL_CA;
  const ssl = {
    rejectUnauthorized: parseBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
  };

  if (caRaw) {
    ssl.ca = caRaw.replace(/\\n/g, '\n');
  }

  return ssl;
}

const ssl = buildSslConfig();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'athena',
  ssl,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
