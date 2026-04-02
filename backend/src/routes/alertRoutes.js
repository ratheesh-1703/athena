const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { sendPushNotification, emitAlertToProtectors, emitToUser } = require('../services/notificationService');

const router = express.Router();

const ESCALATION_TIMEOUT_MS = 2 * 60 * 1000;

router.post('/alert', authRequired, async (req, res) => {
  try {
    const victimId = req.user.id;
    const { latitude, longitude, triggerType = 'manual', verificationStartedAt = null } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    const [alertResult] = await db.query(
      `INSERT INTO alerts (victim_id, latitude, longitude, status, trigger_type, verification_started_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
      [victimId, latitude, longitude, triggerType, verificationStartedAt]
    );

    const alertId = alertResult.insertId;

    const [protectors] = await db.query(
      `SELECT id, name, email, phone, latitude, longitude, fcm_token,
        (6371000 * acos(
          cos(radians(?)) * cos(radians(latitude))
          * cos(radians(longitude) - radians(?))
          + sin(radians(?)) * sin(radians(latitude))
        )) AS distance
      FROM users
      WHERE is_protector_active = 1
        AND role IN ('protector', 'both')
        AND id <> ?
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      HAVING distance < 500
      ORDER BY distance ASC`,
      [latitude, longitude, latitude, victimId]
    );

    const tokens = protectors.map((p) => p.fcm_token).filter(Boolean);
    await sendPushNotification(
      tokens,
      'EMERGENCY ALERT',
      'Person in danger nearby. Tap to view and help.',
      { alertId, victimId, latitude, longitude }
    );

    emitAlertToProtectors(protectors, {
      alertId,
      victimId,
      latitude,
      longitude,
      triggerType,
      message: 'EMERGENCY ALERT: Person in danger nearby.',
    });

    await db.query(
      `INSERT INTO escalation_events (alert_id, escalation_type, status, payload, due_at)
       VALUES (?, 'reminder', 'triggered', ?, ?)` ,
      [
        alertId,
        JSON.stringify({ reason: 'No guardian acknowledgment in 2 minutes' }),
        new Date(Date.now() + ESCALATION_TIMEOUT_MS),
      ]
    );

    return res.status(201).json({
      alertId,
      message: 'Alert sent to nearby protectors',
      nearbyProtectors: protectors.map(({ id, name, distance }) => ({ id, name, distance })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to trigger alert', error: error.message });
  }
});

router.get('/alerts/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM alerts WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    const [responses] = await db.query(
      `SELECT pr.id, pr.alert_id, pr.protector_id, pr.status, pr.timestamp, u.name AS protector_name
       FROM protector_responses pr
       JOIN users u ON u.id = pr.protector_id
       WHERE pr.alert_id = ?
       ORDER BY pr.timestamp DESC`,
      [req.params.id]
    );

    return res.json({ alert: rows[0], responses });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch alert details', error: error.message });
  }
});

router.get('/alerts/:id/responses', authRequired, async (req, res) => {
  try {
    const alertId = Number(req.params.id);
    const [responses] = await db.query(
      `SELECT pr.id, pr.alert_id, pr.protector_id, pr.status, pr.timestamp, u.name AS protector_name
       FROM protector_responses pr
       JOIN users u ON u.id = pr.protector_id
       WHERE pr.alert_id = ?
       ORDER BY pr.timestamp DESC`,
      [alertId]
    );

    return res.json({ responses });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch responses', error: error.message });
  }
});

router.post('/alerts/:id/respond', authRequired, async (req, res) => {
  try {
    const alertId = Number(req.params.id);
    const protectorId = req.user.id;
    const { status = 'accepted' } = req.body;

    const [alerts] = await db.query('SELECT * FROM alerts WHERE id = ?', [alertId]);
    if (!alerts.length) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    const [users] = await db.query('SELECT role FROM users WHERE id = ?', [protectorId]);
    const protectorRole = users.length ? users[0].role : null;
    if (!['protector', 'both'].includes(protectorRole)) {
      return res.status(403).json({ message: 'Only protector-enabled users can respond to alerts' });
    }

    await db.query(
      `INSERT INTO protector_responses (alert_id, protector_id, status)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), timestamp = CURRENT_TIMESTAMP`,
      [alertId, protectorId, status]
    );

    emitToUser(alerts[0].victim_id, 'protector-update', {
      alertId,
      protectorId,
      status,
      message: status === 'accepted' ? 'Protector is coming to help' : `Protector status updated: ${status}`,
    });

    return res.status(201).json({
      message: 'Response recorded',
      victimMessage: status === 'accepted' ? 'Protector is coming to help' : 'Protector updated response',
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save protector response', error: error.message });
  }
});

router.patch('/alerts/:id/protector-progress', authRequired, async (req, res) => {
  try {
    const alertId = Number(req.params.id);
    const protectorId = req.user.id;
    const { status } = req.body;

    if (!status || !['enroute', 'arrived', 'declined', 'accepted'].includes(status)) {
      return res.status(400).json({ message: 'valid status is required' });
    }

    const [alerts] = await db.query('SELECT * FROM alerts WHERE id = ?', [alertId]);
    if (!alerts.length) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    await db.query(
      `INSERT INTO protector_responses (alert_id, protector_id, status)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), timestamp = CURRENT_TIMESTAMP`,
      [alertId, protectorId, status]
    );

    emitToUser(alerts[0].victim_id, 'protector-update', {
      alertId,
      protectorId,
      status,
      message: `Protector update: ${status}`,
    });

    return res.json({ message: 'Protector progress updated' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update protector progress', error: error.message });
  }
});

router.patch('/alerts/:id/status', authRequired, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'status is required' });
    }

    await db.query('UPDATE alerts SET status = ? WHERE id = ?', [status, req.params.id]);
    return res.json({ message: 'Alert status updated' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update alert status', error: error.message });
  }
});

router.post('/alerts/:id/ack', authRequired, async (req, res) => {
  try {
    const alertId = Number(req.params.id);
    const { actorType = 'guardian', actorName = null, actorPhone = null } = req.body;

    const [alerts] = await db.query('SELECT id, victim_id, status FROM alerts WHERE id = ? LIMIT 1', [alertId]);
    if (!alerts.length) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    if (alerts[0].status !== 'active') {
      return res.status(400).json({ message: 'Alert is no longer active' });
    }

    await db.query(
      `INSERT INTO alert_acknowledgements (alert_id, actor_type, actor_user_id, actor_name, actor_phone)
       VALUES (?, ?, ?, ?, ?)`,
      [alertId, actorType, req.user.id, actorName, actorPhone]
    );

    await db.query(
      `UPDATE escalation_events
       SET status = 'completed', processed_at = NOW(), last_error = NULL
       WHERE alert_id = ? AND status = 'triggered'`,
      [alertId]
    );

    emitToUser(alerts[0].victim_id, 'guardian-ack', {
      alertId,
      actorType,
      actorName,
      message: 'A guardian/protector acknowledged your alert',
    });

    return res.status(201).json({ message: 'Acknowledgement recorded' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to acknowledge alert', error: error.message });
  }
});

router.post('/alerts/:id/escalate', authRequired, async (req, res) => {
  try {
    const alertId = Number(req.params.id);
    const { escalationType = 'authority_112', payload = {} } = req.body;

    const [alerts] = await db.query('SELECT id, victim_id, latitude, longitude FROM alerts WHERE id = ? LIMIT 1', [alertId]);
    if (!alerts.length) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    await db.query(
      `INSERT INTO escalation_events (alert_id, escalation_type, status, payload)
       VALUES (?, ?, 'completed', ?)`,
      [alertId, escalationType, JSON.stringify({ ...payload, requestedBy: req.user.id })]
    );

    emitToUser(alerts[0].victim_id, 'guardian-escalation', {
      alertId,
      escalationType,
      message: escalationType === 'authority_112' ? 'Escalation recorded: call 112 flow initiated' : 'Escalation recorded',
    });

    return res.status(201).json({
      message: 'Escalation recorded',
      escalationType,
      suggestedAction: escalationType === 'authority_112' ? 'Dial emergency helpline 112 immediately' : null,
      lastKnownLocation: {
        latitude: alerts[0].latitude,
        longitude: alerts[0].longitude,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to escalate alert', error: error.message });
  }
});

router.patch('/alerts/:id/close', authRequired, async (req, res) => {
  try {
    const alertId = Number(req.params.id);
    const { pin, closureReason = 'resolved', victimNote = null } = req.body;

    if (!pin) {
      return res.status(400).json({ message: 'Emergency PIN is required to close alert' });
    }

    const [alerts] = await db.query(
      `SELECT id, victim_id, latitude, longitude, status, activated_at
       FROM alerts
       WHERE id = ?
       LIMIT 1`,
      [alertId]
    );
    if (!alerts.length) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    const alert = alerts[0];
    if (alert.victim_id !== req.user.id) {
      return res.status(403).json({ message: 'Only the victim can close this alert with PIN' });
    }

    const [securityRows] = await db.query('SELECT emergency_pin_hash FROM user_security WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!securityRows.length || !securityRows[0].emergency_pin_hash) {
      return res.status(400).json({ message: 'Emergency PIN is not configured' });
    }

    const pinOk = await bcrypt.compare(String(pin), securityRows[0].emergency_pin_hash);
    if (!pinOk) {
      return res.status(401).json({ message: 'Invalid emergency PIN' });
    }

    await db.query(
      `UPDATE alerts
       SET status = 'resolved', resolved_at = NOW(), closure_reason = ?, closed_by_user_id = ?
       WHERE id = ?`,
      [closureReason, req.user.id, alertId]
    );

    const [evidenceRows] = await db.query(
      `SELECT id, timestamp, video_path, audio_path
       FROM evidence
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 5`,
      [req.user.id]
    );

    await db.query(
      `INSERT INTO incident_reports (
         alert_id, victim_id, closed_by_user_id, closure_reason, victim_note,
         activated_at, closed_at, location_snapshot, evidence_summary
       )
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         closed_by_user_id = VALUES(closed_by_user_id),
         closure_reason = VALUES(closure_reason),
         victim_note = VALUES(victim_note),
         closed_at = VALUES(closed_at),
         location_snapshot = VALUES(location_snapshot),
         evidence_summary = VALUES(evidence_summary)`,
      [
        alertId,
        req.user.id,
        req.user.id,
        closureReason,
        victimNote,
        alert.activated_at,
        JSON.stringify({ latitude: alert.latitude, longitude: alert.longitude }),
        JSON.stringify(evidenceRows),
      ]
    );

    return res.json({ message: 'Alert closed and incident report saved' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to close alert', error: error.message });
  }
});

router.get('/alerts/:id/report', authRequired, async (req, res) => {
  try {
    const alertId = Number(req.params.id);
    const [rows] = await db.query(
      `SELECT ir.*, u.name AS victim_name
       FROM incident_reports ir
       JOIN users u ON u.id = ir.victim_id
       WHERE ir.alert_id = ?
       LIMIT 1`,
      [alertId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Incident report not found' });
    }

    return res.json({ report: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch incident report', error: error.message });
  }
});

module.exports = router;
