const admin = require('firebase-admin');

let firebaseInitialized = false;
let ioRef = null;

function initializeFirebase() {
  const projectId = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey || firebaseInitialized) {
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  firebaseInitialized = true;
}

function setIo(io) {
  ioRef = io;
}

async function sendPushNotification(tokens, title, body, data = {}) {
  initializeFirebase();

  const validTokens = (tokens || []).filter(Boolean);
  if (!validTokens.length) {
    return { sent: 0, reason: 'No tokens' };
  }

  if (firebaseInitialized) {
    const message = {
      notification: { title, body },
      tokens: validTokens,
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, String(value)])
      ),
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    return { sent: response.successCount, failed: response.failureCount };
  }

  return { sent: 0, reason: 'Firebase not configured' };
}

function emitAlertToProtectors(protectors, payload) {
  if (!ioRef) {
    return;
  }

  for (const protector of protectors) {
    ioRef.to(`user:${protector.id}`).emit('emergency-alert', payload);
  }
}

function emitToUser(userId, eventName, payload) {
  if (!ioRef || !userId) {
    return;
  }

  ioRef.to(`user:${userId}`).emit(eventName, payload);
}

module.exports = {
  sendPushNotification,
  emitAlertToProtectors,
  emitToUser,
  setIo,
};
