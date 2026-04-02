const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { createOtpVerificationRecord, verifyOtpCode } = require('../services/otpService');

const router = express.Router();

function signOtpVerificationToken(phone) {
  return jwt.sign(
    { phone, otpVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

async function getSetupStatus(userId) {
  const [[securityRow]] = await db.query(
    `SELECT phone_verified, emergency_pin_hash
     FROM user_security
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );

  const [[profileRow]] = await db.query(
    `SELECT id, home_latitude, home_longitude, office_latitude, office_longitude, night_travel_monitoring
     FROM safety_profiles
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );

  const [[contactCountRow]] = await db.query(
    'SELECT COUNT(*) AS count FROM emergency_contacts WHERE user_id = ?',
    [userId]
  );

  const contactsCount = Number(contactCountRow?.count || 0);
  const hasHome = profileRow?.home_latitude != null && profileRow?.home_longitude != null;
  const hasOffice = profileRow?.office_latitude != null && profileRow?.office_longitude != null;
  const setupComplete = Boolean(
    securityRow?.phone_verified &&
      securityRow?.emergency_pin_hash &&
      contactsCount >= 2 &&
      hasHome &&
      hasOffice
  );

  return {
    phoneVerified: Boolean(securityRow?.phone_verified),
    emergencyPinSet: Boolean(securityRow?.emergency_pin_hash),
    contactsCount,
    minimumGuardiansMet: contactsCount >= 2,
    safetyProfileSet: Boolean(profileRow?.id && hasHome && hasOffice),
    nightTravelMonitoring: Boolean(profileRow?.night_travel_monitoring),
    setupComplete,
  };
}

function normalizeRole(role) {
  if (!role) {
    return 'both';
  }

  const normalized = String(role).toLowerCase();
  if (normalized === 'user') {
    return 'victim';
  }

  if (['victim', 'protector', 'both'].includes(normalized)) {
    return normalized;
  }

  return 'both';
}

async function resolveRoleId(roleName) {
  const [rows] = await db.query('SELECT id FROM roles WHERE name = ? LIMIT 1', [roleName]);
  return rows.length ? rows[0].id : null;
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, role = 'both', otpVerificationToken } = req.body;
    const normalizedRole = normalizeRole(role);
    const roleId = await resolveRoleId(normalizedRole);

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: 'name, email, phone, password are required' });
    }

    if (!otpVerificationToken) {
      return res.status(400).json({ message: 'OTP verification is required before registration' });
    }

    let decodedOtpToken;
    try {
      decodedOtpToken = jwt.verify(otpVerificationToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Invalid or expired OTP verification token' });
    }

    if (!decodedOtpToken?.otpVerified || decodedOtpToken?.phone !== phone) {
      return res.status(401).json({ message: 'Phone number is not OTP verified' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await db.query(
      `INSERT INTO users (name, email, phone, password, role, role_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, phone, passwordHash, normalizedRole, roleId]
    );

    const [rows] = await db.query(
      'SELECT id, name, email, phone, role, is_protector_active FROM users WHERE id = ?',
      [result.insertId]
    );

    await db.query(
      `INSERT INTO user_security (user_id, phone_verified, trusted_device)
       VALUES (?, 1, 1)
       ON DUPLICATE KEY UPDATE phone_verified = VALUES(phone_verified), trusted_device = VALUES(trusted_device)`,
      [result.insertId]
    );

    const token = signToken(rows[0]);
    const setup = await getSetupStatus(result.insertId);
    return res.status(201).json({ token, user: rows[0], setup });
  } catch (error) {
    return res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

router.post('/request-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ message: 'phone is required' });
    }

    const record = await createOtpVerificationRecord(db, phone);
    return res.json({ message: 'OTP generated', ...(record.otpPreview ? { otpPreview: record.otpPreview } : {}) });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate OTP', error: error.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    const result = await verifyOtpCode(db, phone, otp);
    if (!result.ok) {
      return res.status(result.status || 400).json({ message: result.reason || 'OTP verification failed' });
    }
    const otpVerificationToken = signOtpVerificationToken(phone);

    return res.json({ message: 'OTP verified', otpVerificationToken });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to verify OTP', error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (fcmToken) {
      await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcmToken, user.id]);
    }

    const token = signToken(user);
    const setup = await getSetupStatus(user.id);
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        latitude: user.latitude,
        longitude: user.longitude,
        is_protector_active: !!user.is_protector_active,
      },
      setup,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, phone, role, latitude, longitude, is_protector_active FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const setup = await getSetupStatus(req.user.id);
    return res.json({ user: rows[0], setup });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user', error: error.message });
  }
});

router.patch('/emergency-pin', authRequired, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || String(pin).length < 4) {
      return res.status(400).json({ message: 'pin is required and must be at least 4 digits' });
    }

    const pinHash = await bcrypt.hash(String(pin), 12);
    await db.query(
      `INSERT INTO user_security (user_id, emergency_pin_hash)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE emergency_pin_hash = VALUES(emergency_pin_hash)`,
      [req.user.id, pinHash]
    );

    const setup = await getSetupStatus(req.user.id);
    return res.json({ message: 'Emergency PIN saved', setup });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update emergency PIN', error: error.message });
  }
});

router.post('/verify-emergency-pin', authRequired, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ message: 'pin is required' });
    }

    const [rows] = await db.query('SELECT emergency_pin_hash FROM user_security WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!rows.length || !rows[0].emergency_pin_hash) {
      return res.status(404).json({ message: 'Emergency PIN is not set' });
    }

    const ok = await bcrypt.compare(String(pin), rows[0].emergency_pin_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid emergency PIN' });
    }

    return res.json({ message: 'Emergency PIN verified' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to verify emergency PIN', error: error.message });
  }
});

router.patch('/protector-mode', authRequired, async (req, res) => {
  try {
    const { isActive } = req.body;
    await db.query('UPDATE users SET is_protector_active = ? WHERE id = ?', [!!isActive, req.user.id]);
    return res.json({ message: 'Protector mode updated', is_protector_active: !!isActive });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update protector mode', error: error.message });
  }
});

router.patch('/location', authRequired, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    await db.query('UPDATE users SET latitude = ?, longitude = ? WHERE id = ?', [latitude, longitude, req.user.id]);
    return res.json({ message: 'Location updated' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update location', error: error.message });
  }
});

router.get('/roles', async (_req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name FROM roles ORDER BY id ASC');
    return res.json({ roles: rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch roles', error: error.message });
  }
});

router.patch('/role', authRequired, async (req, res) => {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ message: 'role is required' });
    }

    const normalizedRole = normalizeRole(role);
    const roleId = await resolveRoleId(normalizedRole);

    await db.query('UPDATE users SET role = ?, role_id = ? WHERE id = ?', [normalizedRole, roleId, req.user.id]);

    return res.json({ message: 'Role updated successfully', role: normalizedRole, role_id: roleId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update role', error: error.message });
  }
});

router.post('/logout', authRequired, async (req, res) => {
  return res.json({ message: 'Logout successful on client-side. Remove token from device storage.' });
});

module.exports = router;
