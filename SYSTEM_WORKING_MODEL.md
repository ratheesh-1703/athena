# ATHENA – Complete Working Model (Victim + Protector)

This document defines the ideal end-to-end ATHENA behavior, including protector role functions, aligned to the existing codebase and ready for implementation planning.

## 1) Installation and Setup Flow

### 1.1 Account Onboarding (Victim First)
1. Mobile number signup
2. OTP verification
3. Create secure emergency PIN (separate from login password)

**Rules**
- OTP is mandatory before activation
- PIN must be required to stop an active emergency
- Device should be marked as trusted after OTP success

### 1.2 Emergency Contacts (Guardian Setup)
- Minimum 2 guardians required before app is marked “fully active”
- Required fields: name, phone, relationship
- Optional field: email

**Guardian relationship examples**
- Father, Mother, Sister, Friend, Spouse, Colleague

### 1.3 Permission Setup
ATHENA requests and validates:
- Location (Always allow)
- Microphone
- Camera
- SMS
- Phone state
- Background activity/battery optimization exclusion (platform dependent)

**Rules**
- If any critical permission is denied, show a persistent setup blocker until resolved
- Graceful fallback: if camera denied, continue with audio + location evidence

### 1.4 Safety Profile Creation
User configures:
- Home Safe Zone (geo-fence)
- Office/College Safe Zone
- Night travel monitoring toggle

After this step, ATHENA transitions to monitoring mode.

---

## 2) Normal Monitoring Mode (Background)

ATHENA runs quietly in background and periodically collects lightweight telemetry:
- GPS snapshot
- Motion state (walking/running/stationary)
- Speed and acceleration deltas
- Route continuity checks

### Battery Optimization Policy
- Use adaptive sampling intervals
  - Normal: every 15–30s
  - Elevated risk: every 5–10s
  - Active emergency: every 5s (or platform-safe minimum)
- Avoid heavy sensor pipelines while device is idle/charging-sensitive
- Batch network calls when possible

---

## 3) Emergency Trigger System

ATHENA supports three trigger families.

### 3.1 Manual SOS
- Red SOS button in app
- Power button multi-press (3–5) where native support exists
- Strong shake detection

### 3.2 Secret Voice Trigger
- User-defined phrase (for example: “Help me”, “Emergency code 21”)
- On detection, emergency is activated silently (no obvious UI reveal to attacker)

### 3.3 Smart Auto Detection (AI Assisted)
Signals considered:
- Sudden running pattern
- Phone snatch-like jerk motion
- Deviation from known route profile
- Sudden fall
- Wearable heart-rate spike (if integrated)

**Verification gate**
- Start 10-second silent verification window
- If user does not cancel with PIN-safe action, emergency auto-activates

---

## 4) Emergency Activation Flow

### 4.1 Live Location Broadcast
- Location updates every 5–10 seconds
- Generate sharable tracking link
- Send to guardians/protectors

**Message template**
- “{VictimName} may be in danger. Track live: {link}”

### 4.2 Evidence Collection
- Start background audio recording immediately
- Start optional camera capture (front/rear policy-based)
- Store local copy + encrypted cloud backup

**Requirement**
- Evidence survives device damage/loss via remote encrypted sync

### 4.3 Guardian Alerting
- In-app push notification
- SMS fallback
- Optional call alert flow

Guardian actions:
- Open live map
- Call victim
- Navigate to victim

### 4.4 Escalation Logic
If no guardian acknowledgment within 2 minutes:
1. Send reminder alert
2. Trigger configured escalation action
   - Option A: auto-dial helpline (112 in India)
   - Option B: share last known location and evidence summary to authority contact channel

---

## 5) Protector Role Functions (Core)

Protector is an active responder role for nearby emergencies.

### 5.1 Protector Availability
- Protector toggles “Available to help” mode
- Backend marks protector as discoverable only when:
  - Role is `protector` or `both`
  - Availability is ON
  - Recent location is valid

### 5.2 Nearby Alert Intake
When emergency happens:
- Backend finds protectors in radius (default 500m, configurable)
- Delivers alert via socket push and FCM/push fallback

Protector receives:
- Victim first name / alias (privacy policy dependent)
- Distance estimate
- Live map entry point
- Time since trigger

### 5.3 Protector Decision Workflow
Protector can:
- Accept
- Decline
- Mark enroute
- Mark arrived
- Mark reached victim/safe handover complete

Victim + guardians should see these status transitions in real time.

### 5.4 Protector Navigation + Communication
- One-tap navigation to victim
- Optional click-to-call masked communication flow
- Multi-protector coordination view (if multiple accepted)

### 5.5 Protector Escalation Assistance
Protector can:
- Forward incident to authorities
- Submit quick field note
- Attach optional on-scene proof (photo/audio, policy gated)

### 5.6 Protector Trust and Safety Controls
- Track responder reliability (accepted vs arrived ratio)
- Abuse reporting and soft-ban controls
- Location precision redaction until accept (privacy-preserving)

---

## 6) Emergency End Flow

Emergency can end by:
- Victim enters secure emergency PIN
- Guardian marks safe with victim confirmation
- System timeout policy + verified closure

At closure, user can:
- Add incident note
- Save incident report

Stored incident bundle:
- Activation timestamp
- Location trail
- Responder timeline
- Evidence links (encrypted)
- Closure reason + actor

---

## 7) Architecture (Target)

## 7.1 Mobile Layer
- Trigger UI and safety setup
- Sensor collectors
- Offline queue
- Evidence capture orchestration

### 7.2 AI/Decision Layer
- Risk scoring from sensor stream
- Silent verification timer orchestration
- False-positive suppression policies

### 7.3 Backend Layer
- Auth and role access
- Real-time alert distribution
- Guardian/protector event state machine
- Incident ledger and audit trail

### 7.4 Cloud/Security Layer
- Encrypted evidence vault
- Key management strategy
- Tamper detection and audit logs

---

## 8) Security and Design Principles

ATHENA must be:
- Silent
- Fast
- Battery efficient
- Tamper-resistant
- Privacy-protected
- Encrypted end-to-end where feasible

Operational requirements:
- JWT/session hardening
- At-rest encryption for evidence
- API rate limits + abuse controls
- Role-based access checks for all incident endpoints

---

## 9) Current Build vs Target (Gap Map)

### Already Present in Current Code
- Role model: victim/protector/both
- Protector mode toggle
- Alert creation and nearby protector distribution
- Protector response statuses: accepted/enroute/arrived/declined
- Emergency contacts CRUD
- Evidence upload flow
- Socket-based alert and status updates

### Missing/Partial for Ideal Model
- Mobile-number + OTP-first onboarding
- Secure emergency PIN for emergency stop
- Mandatory minimum 2 guardians at setup completion
- Always-on background location strategy per OS constraints
- True voice phrase trigger integration (native)
- True power-button multi-press native trigger
- AI auto-detection + 10-second silent verification gate
- Guardian acknowledgment timer and automatic escalation policy
- Incident report object with full timeline and closure metadata
- Protector trust scoring / abuse moderation controls

---

## 10) Suggested API Additions (for Protector + Guardian Completion)

- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `PATCH /api/auth/emergency-pin`
- `POST /api/alerts/:id/ack` (guardian ack)
- `POST /api/alerts/:id/escalate` (authority escalation)
- `PATCH /api/alerts/:id/close` (PIN-validated closure)
- `PATCH /api/alerts/:id/protector-progress` (extend with `reached_victim`)
- `POST /api/incidents/:id/note`
- `GET /api/incidents/:id/report`

---

## 11) Suggested Data Model Additions

- `user_security` (otp_verified, emergency_pin_hash, trusted_device)
- `safety_profiles` (home_geo, office_geo, night_monitoring)
- `alert_acknowledgements` (actor_type, actor_id, timestamp)
- `incident_reports` (summary, closed_by, closure_reason, note)
- `protector_scores` (reliability metrics)
- `escalation_events` (type, payload, status)

---

## 12) Definition of “Working End-to-End”

ATHENA is considered fully working when all are true:
1. User completes OTP + emergency PIN + 2 guardians + permissions + safety profile
2. Monitoring runs in low-battery background policy
3. Any trigger path activates emergency in under target SLA
4. Guardians and protectors receive timely actionable alerts
5. Evidence is captured and securely recoverable
6. Escalation executes if no response in policy window
7. Incident can be safely closed and report generated
