# ATHENA – Community Powered Active Protection and Women Safety Application

ATHENA is a full-stack emergency protection system with:

- Mobile app (React Native + Expo) for victims and protectors
- Backend API (Node.js + Express)
- MySQL database
- Real-time protector alerts using Socket.IO and optional FCM push

## Product Working Model

For the complete start-to-finish operating model (installation, monitoring, triggers, guardian escalation, and protector role functions), see:

- [SYSTEM_WORKING_MODEL.md](SYSTEM_WORKING_MODEL.md)

## Project Structure

- `backend/` → Express API, MySQL integration, JWT auth, alerts, evidence upload
- `mobile/` → React Native app with protection mode, maps, shake trigger, camera recording flow

## Features Implemented

### 1) Authentication and Roles

- Register/login/logout
- JWT-protected APIs
- Password hashing with bcrypt
- Roles: `victim`, `protector`, `both`
- Toggle Protector Mode (`is_protector_active`)

### 2) Active Protection Mode

Activation methods implemented:

- Emergency button
- Shake detection (accelerometer)

Activation flow:

- Loud siren audio loop
- Police warning voice playback
- Camera recording start
- Flash torch via camera flash mode
- Full-screen Protection Mode overlay
- GPS capture and backend alert
- Local evidence save and upload
- Audio evidence recording and upload
- Offline alert queue (auto-sent when connectivity returns)

### 3) Protector Network Alerts

- Backend finds protectors in 500m radius (Haversine SQL)
- Sends emergency events via Socket.IO
- Optional FCM support if Firebase env vars are configured

### 4) Protector Response

- Protector receives alert in app
- Map view opens with victim location
- `ACCEPT TO HELP` posts response
- Backend stores in `protector_responses`
- Protector progress updates (`enroute`, `arrived`, `declined`)

### 5) Maps + Location

- Victim map shows own location
- Protector map shows victim + protector positions
- Location sync to backend

### 6) Emergency Contacts

- Emergency contacts CRUD
- One-tap call, SMS, and share live location

### 7) Evidence Collection

- Video + audio evidence upload
- Encrypted metadata (GPS + timestamp)

---

## Backend Setup (`backend/`)

1. Install dependencies:

```bash
cd backend
npm install
```

2. Configure env:

```bash
copy .env.example .env
```

3. Create MySQL schema:

- Run SQL file: `src/db/schema.sql`

4. Start server:

```bash
npm run dev
```

Server base URL: `http://localhost:5000`

### Main API Endpoints

- `POST /api/auth/register`
- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/auth/emergency-pin`
- `POST /api/auth/verify-emergency-pin`
- `GET /api/auth/roles`
- `PATCH /api/auth/role`
- `PATCH /api/auth/protector-mode`
- `PATCH /api/auth/location`
- `GET /api/users/profile`
- `PATCH /api/users/profile`
- `GET /api/setup-status`
- `GET /api/safety-profile`
- `PUT /api/safety-profile`
- `GET /api/emergency-contacts`
- `POST /api/emergency-contacts`
- `DELETE /api/emergency-contacts/:id`
- `POST /api/alert`
- `GET /api/alerts/:id`
- `POST /api/alerts/:id/respond`
- `POST /api/alerts/:id/ack`
- `POST /api/alerts/:id/escalate`
- `PATCH /api/alerts/:id/close`
- `GET /api/alerts/:id/report`
- `GET /api/alerts/:id/responses`
- `PATCH /api/alerts/:id/protector-progress`
- `PATCH /api/alerts/:id/status`
- `POST /api/evidence/upload`

---

## Mobile Setup (`mobile/`)

1. Install dependencies:

```bash
cd mobile
npm install
```

2. Configure backend URL:

```bash
copy .env.example .env
```

For Android emulator, keep `EXPO_PUBLIC_BACKEND_URL=http://10.0.2.2:5000`.

3. Start app:

```bash
npm start
```

4. Run on Android:

```bash
npm run android

## Production Deployment (VPS + MySQL)

### Backend (VPS)

1. Install Node.js 18+, PM2, and MySQL:

```bash
sudo apt update
sudo apt install -y nodejs npm mysql-server
sudo npm install -g pm2
```

2. Create database and user:

```sql
CREATE DATABASE athena;
CREATE USER 'athena'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON athena.* TO 'athena'@'localhost';
FLUSH PRIVILEGES;
```

3. Upload backend and set env:

```bash
cd backend
cp .env.production.example .env
# edit .env with production values
```

4. Apply schema:

```bash
mysql -u athena -p athena < src/db/schema.sql
```

5. Start server with PM2:

```bash
pm2 start ecosystem.config.js
pm2 save
```

### Mobile (Android + iOS)

This project is configured for EAS builds in [mobile/eas.json](mobile/eas.json).

1. Install EAS CLI:

```bash
npm install -g eas-cli
```

2. Build Android (APK preview / AAB production):

```bash
cd mobile
eas build -p android --profile preview
eas build -p android --profile production
```

3. Build iOS (requires Apple developer account):

```bash
eas build -p ios --profile production
```

## Store Assets Checklist

### Play Store (Android)

- App icon: 512x512 PNG
- Feature graphic: 1024x500 PNG
- Phone screenshots: 1080x1920 (min 2, up to 8)
- 7-inch tablet screenshots (optional)
- 10-inch tablet screenshots (optional)
- Short description (max 80 chars)
- Full description

### App Store (iOS)

- App icon: 1024x1024 PNG
- iPhone screenshots (6.5-inch, 6.7-inch)
- iPad screenshots (optional)
- Subtitle (max 30 chars)
- Description, keywords, support URL, privacy policy URL
```

---

## Important Notes

- Power button triple-press trigger requires native Android integration (outside Expo-managed default setup).
- Voice phrase detection (`"HELP"`) requires native speech recognition integration/plugin.
- Current scaffold maps those triggers to emergency activation but does not perform true OS-level detection yet.
- For production: add HTTPS, encrypted media at rest, stronger audit logging, and secure cloud evidence storage.

---

## Security

- JWT authentication middleware for protected routes
- Password hashing using bcrypt
- Protected APIs for alerts/evidence/responses
- Helmet + API rate limiting enabled

---

## Optional FCM Setup

Set these in `backend/.env`:

- `FCM_PROJECT_ID`
- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY` (with escaped newlines)

Without these, Socket.IO still provides real-time emergency alert delivery.
