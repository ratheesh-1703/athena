CREATE DATABASE IF NOT EXISTS athena;
USE athena;

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO roles (id, name) VALUES
  (1, 'user'),
  (2, 'victim'),
  (3, 'protector'),
  (4, 'both');

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) UNIQUE NOT NULL,
  phone VARCHAR(30) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('victim', 'protector', 'both') DEFAULT 'both',
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  is_protector_active BOOLEAN DEFAULT FALSE,
  fcm_token TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_id INT NULL AFTER role;

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'fk_users_role'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @fk_sql := IF(
  @fk_exists = 0,
  'ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE users u
LEFT JOIN roles r ON r.name = u.role
SET u.role_id = r.id
WHERE u.role_id IS NULL;

CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  victim_id INT NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  status ENUM('active', 'resolved', 'cancelled') DEFAULT 'active',
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (victim_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_alert_status (status),
  INDEX idx_alert_time (timestamp)
);

CREATE TABLE IF NOT EXISTS protector_responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id INT NOT NULL,
  protector_id INT NOT NULL,
  status ENUM('accepted', 'enroute', 'arrived', 'declined') DEFAULT 'accepted',
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alert_protector (alert_id, protector_id),
  FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
  FOREIGN KEY (protector_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evidence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  video_path VARCHAR(500) NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE evidence
  MODIFY COLUMN video_path VARCHAR(500) NULL;

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS audio_path VARCHAR(500) NULL;

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS meta_encrypted TEXT NULL;

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  contact_name VARCHAR(120) NOT NULL,
  contact_phone VARCHAR(30) NOT NULL,
  contact_email VARCHAR(190) NULL,
  relationship VARCHAR(80) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_contacts (user_id)
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(30) NOT NULL,
  otp_code VARCHAR(10) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  attempts INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_phone (phone),
  INDEX idx_otp_expires (expires_at)
);

ALTER TABLE otp_verifications
  ADD COLUMN IF NOT EXISTS otp_hash VARCHAR(255) NULL AFTER otp_code;

ALTER TABLE otp_verifications
  ADD COLUMN IF NOT EXISTS last_sent_at DATETIME NULL AFTER otp_hash;

CREATE TABLE IF NOT EXISTS user_security (
  user_id INT PRIMARY KEY,
  phone_verified BOOLEAN DEFAULT FALSE,
  emergency_pin_hash VARCHAR(255) NULL,
  trusted_device BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS safety_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  home_latitude DECIMAL(10, 7) NULL,
  home_longitude DECIMAL(10, 7) NULL,
  office_latitude DECIMAL(10, 7) NULL,
  office_longitude DECIMAL(10, 7) NULL,
  night_travel_monitoring BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS trigger_type ENUM('manual', 'voice', 'auto') DEFAULT 'manual' AFTER status;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS verification_started_at DATETIME NULL AFTER trigger_type;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS activated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER verification_started_at;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL AFTER activated_at;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS closure_reason VARCHAR(255) NULL AFTER resolved_at;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS closed_by_user_id INT NULL AFTER closure_reason;

SET @alerts_closed_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'alerts'
    AND CONSTRAINT_NAME = 'fk_alerts_closed_by_user'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @alerts_closed_fk_sql := IF(
  @alerts_closed_fk_exists = 0,
  'ALTER TABLE alerts ADD CONSTRAINT fk_alerts_closed_by_user FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_alerts_closed_fk FROM @alerts_closed_fk_sql;
EXECUTE stmt_alerts_closed_fk;
DEALLOCATE PREPARE stmt_alerts_closed_fk;

CREATE TABLE IF NOT EXISTS alert_acknowledgements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id INT NOT NULL,
  actor_type ENUM('guardian', 'protector', 'victim') NOT NULL,
  actor_user_id INT NULL,
  actor_name VARCHAR(120) NULL,
  actor_phone VARCHAR(30) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_alert_ack (alert_id)
);

CREATE TABLE IF NOT EXISTS escalation_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id INT NOT NULL,
  escalation_type ENUM('reminder', 'authority_112', 'last_known_location_share') NOT NULL,
  status ENUM('triggered', 'completed', 'failed') DEFAULT 'triggered',
  payload JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
  INDEX idx_escalation_alert (alert_id)
);

ALTER TABLE escalation_events
  ADD COLUMN IF NOT EXISTS due_at DATETIME NULL AFTER payload;

ALTER TABLE escalation_events
  ADD COLUMN IF NOT EXISTS processed_at DATETIME NULL AFTER due_at;

ALTER TABLE escalation_events
  ADD COLUMN IF NOT EXISTS last_error TEXT NULL AFTER processed_at;

ALTER TABLE escalation_events
  ADD INDEX IF NOT EXISTS idx_escalation_due (status, due_at);

CREATE TABLE IF NOT EXISTS incident_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id INT NOT NULL UNIQUE,
  victim_id INT NOT NULL,
  closed_by_user_id INT NULL,
  closure_reason VARCHAR(255) NULL,
  victim_note TEXT NULL,
  activated_at DATETIME NOT NULL,
  closed_at DATETIME NOT NULL,
  location_snapshot JSON NULL,
  evidence_summary JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
  FOREIGN KEY (victim_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
