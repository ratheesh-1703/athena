const express = require('express');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

async function buildSetupStatus(userId) {
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

  return {
    phoneVerified: Boolean(securityRow?.phone_verified),
    emergencyPinSet: Boolean(securityRow?.emergency_pin_hash),
    contactsCount,
    minimumGuardiansMet: contactsCount >= 2,
    safetyProfileSet: Boolean(profileRow?.id && hasHome && hasOffice),
    nightTravelMonitoring: Boolean(profileRow?.night_travel_monitoring),
    setupComplete: Boolean(
      securityRow?.phone_verified &&
        securityRow?.emergency_pin_hash &&
        contactsCount >= 2 &&
        hasHome &&
        hasOffice
    ),
  };
}

router.get('/users/profile', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, phone, role, role_id, latitude, longitude, is_protector_active
       FROM users
       WHERE id = ?`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ profile: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch profile', error: error.message });
  }
});

router.patch('/users/profile', authRequired, async (req, res) => {
  try {
    const { name, phone, email } = req.body;

    const [currentRows] = await db.query('SELECT id, email FROM users WHERE id = ?', [req.user.id]);
    if (!currentRows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const nextName = name ?? currentRows[0].name;
    const nextPhone = phone ?? currentRows[0].phone;
    const nextEmail = email ?? currentRows[0].email;

    if (email && email !== currentRows[0].email) {
      const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id <> ?', [email, req.user.id]);
      if (existing.length) {
        return res.status(409).json({ message: 'Email already in use by another account' });
      }
    }

    await db.query('UPDATE users SET name = ?, phone = ?, email = ? WHERE id = ?', [nextName, nextPhone, nextEmail, req.user.id]);

    return res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update profile', error: error.message });
  }
});

router.get('/emergency-contacts', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, contact_name, contact_phone, contact_email, relationship, created_at
       FROM emergency_contacts
       WHERE user_id = ?
       ORDER BY id DESC`,
      [req.user.id]
    );

    return res.json({ contacts: rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch emergency contacts', error: error.message });
  }
});

router.post('/emergency-contacts', authRequired, async (req, res) => {
  try {
    const { contactName, contactPhone, contactEmail = null, relationship = null } = req.body;

    if (!contactName || !contactPhone || !relationship) {
      return res.status(400).json({ message: 'contactName, contactPhone and relationship are required' });
    }

    const [result] = await db.query(
      `INSERT INTO emergency_contacts (user_id, contact_name, contact_phone, contact_email, relationship)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, contactName, contactPhone, contactEmail, relationship]
    );

    return res.status(201).json({ message: 'Emergency contact added', contactId: result.insertId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add emergency contact', error: error.message });
  }
});

router.delete('/emergency-contacts/:id', authRequired, async (req, res) => {
  try {
    const [[countRow]] = await db.query('SELECT COUNT(*) AS count FROM emergency_contacts WHERE user_id = ?', [req.user.id]);
    if (Number(countRow?.count || 0) <= 2) {
      return res.status(400).json({ message: 'Minimum 2 emergency contacts are required' });
    }

    const [result] = await db.query('DELETE FROM emergency_contacts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Emergency contact not found' });
    }

    return res.json({ message: 'Emergency contact removed' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove emergency contact', error: error.message });
  }
});

router.get('/setup-status', authRequired, async (req, res) => {
  try {
    const setup = await buildSetupStatus(req.user.id);
    return res.json({ setup });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch setup status', error: error.message });
  }
});

router.get('/safety-profile', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT home_latitude, home_longitude, office_latitude, office_longitude, night_travel_monitoring
       FROM safety_profiles
       WHERE user_id = ?
       LIMIT 1`,
      [req.user.id]
    );

    return res.json({ profile: rows[0] || null });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch safety profile', error: error.message });
  }
});

router.put('/safety-profile', authRequired, async (req, res) => {
  try {
    const {
      homeLatitude,
      homeLongitude,
      officeLatitude,
      officeLongitude,
      nightTravelMonitoring = false,
    } = req.body;

    if (
      homeLatitude === undefined ||
      homeLongitude === undefined ||
      officeLatitude === undefined ||
      officeLongitude === undefined
    ) {
      return res.status(400).json({ message: 'home and office coordinates are required' });
    }

    await db.query(
      `INSERT INTO safety_profiles (user_id, home_latitude, home_longitude, office_latitude, office_longitude, night_travel_monitoring)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         home_latitude = VALUES(home_latitude),
         home_longitude = VALUES(home_longitude),
         office_latitude = VALUES(office_latitude),
         office_longitude = VALUES(office_longitude),
         night_travel_monitoring = VALUES(night_travel_monitoring)`,
      [req.user.id, homeLatitude, homeLongitude, officeLatitude, officeLongitude, !!nightTravelMonitoring]
    );

    const setup = await buildSetupStatus(req.user.id);
    return res.json({ message: 'Safety profile updated', setup });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update safety profile', error: error.message });
  }
});

module.exports = router;
