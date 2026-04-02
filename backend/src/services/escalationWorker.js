const db = require('../config/db');
const { sendPushNotification, emitToUser } = require('./notificationService');

const DEFAULT_POLL_MS = 15000;

async function processReminderEscalation(eventRow) {
  const alertId = Number(eventRow.alert_id);

  const [alerts] = await db.query(
    'SELECT id, victim_id, latitude, longitude, status FROM alerts WHERE id = ? LIMIT 1',
    [alertId]
  );

  if (!alerts.length || alerts[0].status !== 'active') {
    return { skip: true, reason: 'alert not active' };
  }

  const [ackRows] = await db.query('SELECT COUNT(*) AS count FROM alert_acknowledgements WHERE alert_id = ?', [alertId]);
  const ackCount = Number(ackRows[0]?.count || 0);
  if (ackCount > 0) {
    return { skip: true, reason: 'already acknowledged' };
  }

  const { victim_id: victimId, latitude, longitude } = alerts[0];

  const [protectors] = await db.query(
    `SELECT fcm_token
     FROM users
     WHERE is_protector_active = 1
       AND role IN ('protector', 'both')
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL
       AND id <> ?`,
    [victimId]
  );

  const tokens = protectors.map((p) => p.fcm_token).filter(Boolean);

  await sendPushNotification(
    tokens,
    'ESCALATION REMINDER',
    'No guardian acknowledgment yet. Assistance still required.',
    { alertId, victimId, latitude, longitude, escalation: 'reminder' }
  );

  emitToUser(victimId, 'guardian-escalation', {
    alertId,
    message: 'No guardian acknowledgment in 2 minutes. Escalation reminder triggered.',
  });

  return { skip: false };
}

async function processEscalationEvent(eventRow) {
  const type = String(eventRow.escalation_type);

  if (type === 'reminder') {
    return processReminderEscalation(eventRow);
  }

  return { skip: true, reason: `Unsupported escalation_type: ${type}` };
}

async function claimDueEvents(limit) {
  // Basic claim strategy: select due triggered events and mark them as processed.
  // This avoids in-memory timers and survives restarts.
  const [rows] = await db.query(
    `SELECT id, alert_id, escalation_type, payload
     FROM escalation_events
     WHERE status = 'triggered'
       AND (due_at IS NULL OR due_at <= NOW())
     ORDER BY id ASC
     LIMIT ?`,
    [limit]
  );

  if (!rows.length) {
    return [];
  }

  // Optimistic claim: set processed_at; if multiple workers run, duplicate processing is still possible.
  // For production scaling, prefer a dedicated queue or SELECT ... FOR UPDATE SKIP LOCKED.
  const ids = rows.map((r) => r.id);
  await db.query(
    `UPDATE escalation_events
     SET processed_at = NOW()
     WHERE id IN (${ids.map(() => '?').join(',')})
       AND status = 'triggered'`,
    ids
  );

  return rows;
}

function startEscalationWorker({ pollMs = DEFAULT_POLL_MS, batchSize = 20 } = {}) {
  const enabled = String(process.env.ESCALATION_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    return { started: false };
  }

  const timer = setInterval(async () => {
    try {
      const events = await claimDueEvents(batchSize);
      for (const eventRow of events) {
        try {
          const result = await processEscalationEvent(eventRow);
          if (result?.skip) {
            await db.query(
              "UPDATE escalation_events SET status = 'completed', last_error = NULL WHERE id = ?",
              [eventRow.id]
            );
          } else {
            await db.query(
              "UPDATE escalation_events SET status = 'completed', last_error = NULL WHERE id = ?",
              [eventRow.id]
            );
          }
        } catch (error) {
          await db.query(
            "UPDATE escalation_events SET status = 'failed', last_error = ? WHERE id = ?",
            [String(error?.message || error), eventRow.id]
          );
        }
      }
    } catch {
      // no-op
    }
  }, pollMs);

  return {
    started: true,
    stop: () => clearInterval(timer),
  };
}

module.exports = { startEscalationWorker };
