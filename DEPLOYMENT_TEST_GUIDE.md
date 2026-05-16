# ATHENA Deployment Test & Launch Guide

This guide walks through testing and launching ATHENA backend + MySQL using Docker Compose on any machine with Docker installed.

## Prerequisites

- Docker Desktop (Windows/Mac) or Docker Engine (Linux)
- Docker Compose (included in Docker Desktop)
- Git (to clone/manage the repo)

### Install Docker

**Windows/Mac:** Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop)

**Linux:**
```bash
sudo apt update
sudo apt install -y docker.io docker-compose
sudo usermod -aG docker $USER
```

After installation, restart your terminal/machine.

---

## Pre-Deployment Validation

### 1. Verify Environment File

```bash
cd /path/to/athena/backend
cat .env
```

**Required checks:**
- `NODE_ENV=production` ✓
- `JWT_SECRET` is not placeholder (not `replace_with_strong_secret`) ✓
- `ENCRYPTION_KEY` length ≥ 32 characters ✓
- `FRONTEND_ORIGIN` is a real domain, not `*` ✓
- `SMS_PROVIDER` is not `console` (unless dev testing) ✓

### 2. Run Predeploy Script

```bash
cd backend
npm run predeploy:check
```

**Expected output:**
```
ok DB SSL is disabled (enable DB_SSL=true when using managed/cloud MySQL)
ok Predeploy checks passed.
```

Exit code must be `0`.

---

## Docker Compose Deployment

### 1. Build and Start Services

From the project root:

```bash
docker compose up -d --build
```

**What this does:**
- Builds the backend image from [backend/Dockerfile](../backend/Dockerfile)
- Starts MySQL container
- Starts backend container
- Creates persistent volume for MySQL data
- Waits for MySQL to be healthy before starting backend

### 2. Monitor Startup (30-60 seconds)

```bash
docker compose logs -f
```

**Expected progression:**
1. MySQL initializes and applies schema from `src/db/schema.sql`
2. Backend installs npm dependencies
3. Backend connects to MySQL and starts listening on port 5000
4. Logs show: `ATHENA backend running on port 5000`

Press `Ctrl+C` to stop following logs.

### 3. Verify Health Check

```bash
curl http://localhost:5000/health
```

**Expected response:**
```json
{
  "status": "ok",
  "database": "connected"
}
```

### 4. Verify Database Schema Applied

```bash
docker compose exec mysql mysql -u root -ppassword athena -e "SHOW TABLES;"
```

**Expected tables:**
```
users
auth_tokens
alerts
protector_responses
safety_profiles
emergency_contacts
evidence
escalation_history
```

---

## Testing Backend API

### Register a Test User

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+918765432109",
    "password": "TestPass123!",
    "name": "Test User"
  }'
```

**Expected response:**
```json
{
  "id": "...",
  "phone": "+918765432109",
  "name": "Test User",
  "roles": ["victim"],
  "created_at": "2026-05-16T..."
}
```

### Request OTP

```bash
curl -X POST http://localhost:5000/api/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+918765432109"
  }'
```

**Expected response:**
```json
{
  "otp": "123456",
  "expiresIn": 300
}
```

### Login with OTP

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+918765432109",
    "password": "TestPass123!"
  }'
```

**Expected response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {...}
}
```

---

## Troubleshooting

### MySQL fails to start

**Error:** `ERROR 2002 (HY000): Can't connect to local MySQL server`

**Solution:**
```bash
# Check MySQL logs
docker compose logs mysql

# Restart MySQL
docker compose restart mysql

# Wait 30 seconds and retry health check
sleep 30
curl http://localhost:5000/health
```

### Backend crashes on startup

**Error:** `Node exited with code 1` or `Missing env var`

**Solution:**
```bash
# Check backend logs for specifics
docker compose logs backend

# Fix .env file
nano backend/.env

# Rebuild
docker compose up -d --build
```

### Port 5000 already in use

**Error:** `Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:5000 -> 0.0.0.0:0`

**Solution:**
Option A - Stop conflicting service:
```bash
# Find what's using port 5000
lsof -i :5000  # macOS/Linux
netstat -ano | findstr :5000  # Windows
```

Option B - Change Docker port mapping in compose:
Edit [docker-compose.yml](../docker-compose.yml) line 32:
```yaml
ports:
  - '5001:5000'  # Changed from 5000:5000
```

---

## Stopping and Cleanup

### Stop containers (keep data)

```bash
docker compose stop
```

### Stop and remove containers (keep volumes)

```bash
docker compose down
```

### Stop, remove containers AND volumes

```bash
docker compose down -v
```

### View running containers

```bash
docker compose ps
```

---

## Production Readiness Checklist

Before pushing to production:

- [ ] Run `npm run predeploy:check` — must exit with code 0
- [ ] Set real JWT_SECRET (generate with `openssl rand -base64 32`)
- [ ] Set real ENCRYPTION_KEY (32+ character random string)
- [ ] Set real FRONTEND_ORIGIN to your domain
- [ ] Configure real SMS provider (Twilio credentials or alternative)
- [ ] Enable DB_SSL if using managed MySQL/cloud database
- [ ] Test all API endpoints with valid data
- [ ] Configure HTTPS reverse proxy (Nginx/Caddy) in front of backend
- [ ] Set up log aggregation (ELK, DataDog, etc.)
- [ ] Configure automated backups for MySQL volumes
- [ ] Document all custom environment variables in team wiki

---

## Next Steps

1. **Mobile Integration:**
   - Set `EXPO_PUBLIC_BACKEND_URL=https://your-domain.com` in EAS build config
   - Test app connectivity to running backend
   - Submit to App Store / Play Store

2. **Monitoring:**
   - Set up health check alerts on `/health` endpoint
   - Monitor container resource usage
   - Track error rates from logs

3. **Security Hardening:**
   - Add rate limiting tuning (already configured but review)
   - Enable WAF rules on reverse proxy
   - Set up DDoS protection if public-facing

---

## Support

- Check logs: `docker compose logs [service]`
- Validate compose: `docker compose config`
- Inspect running containers: `docker ps`
- See volumes: `docker volume ls`
