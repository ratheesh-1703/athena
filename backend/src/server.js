require('dotenv').config();

const { validateEnv } = require('./config/env');

validateEnv();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const alertRoutes = require('./routes/alertRoutes');
const evidenceRoutes = require('./routes/evidenceRoutes');
const userRoutes = require('./routes/userRoutes');
const { authRequired } = require('./middleware/auth');
const { setIo } = require('./services/notificationService');
const { startEscalationWorker } = require('./services/escalationWorker');

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.set('trust proxy', 1);

function parseAllowedOrigins() {
  const raw = String(process.env.FRONTEND_ORIGIN || '*');
  if (raw === '*') {
    return '*';
  }
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

const io = new Server(server, {
  cors: {
    origin: parseAllowedOrigins(),
    methods: ['GET', 'POST'],
  },
});

setIo(io);

const allowedOrigins = parseAllowedOrigins();
function originChecker(origin, callback) {
  // allow non-browser requests (no origin)
  if (!origin) return callback(null, true);
  if (allowedOrigins === '*' || (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin))) {
    return callback(null, true);
  }
  return callback(new Error('Not allowed by CORS'));
}

const corsOptions = {
  origin: originChecker,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(express.json({ limit: '10mb' }));

// DEV: log register requests to help debug client payload issues
app.use((req, res, next) => {
  try {
    if (req.path === '/api/auth/register') {
      console.log('[DEBUG] /api/auth/register incoming', {
        method: req.method,
        origin: req.headers.origin,
        contentType: req.headers['content-type'],
        body: req.body,
      });
    }
  } catch (err) {
    // ignore logging errors
  }
  return next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const alertLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);

app.use('/api/auth/request-otp', otpLimiter);
app.use('/api/auth/verify-otp', otpLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/alert', alertLimiter);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    return res.json({ status: 'ok', database: 'connected' });
  } catch {
    return res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api', alertRoutes);
app.use('/api', evidenceRoutes);
app.use('/api', userRoutes);

app.get('/api/protected/ping', authRequired, (req, res) => {
  return res.json({ message: `Authenticated as user ${req.user.id}` });
});

io.on('connection', (socket) => {
  socket.on('register-user', ({ userId }) => {
    if (userId) {
      socket.join(`user:${userId}`);
    }
  });
});

const port = Number(process.env.PORT || 5000);
server.listen(port, () => {
  console.log(`ATHENA backend running on port ${port}`);
  startEscalationWorker({
    pollMs: Number(process.env.ESCALATION_POLL_MS || 15000),
    batchSize: Number(process.env.ESCALATION_BATCH_SIZE || 20),
  });
});
