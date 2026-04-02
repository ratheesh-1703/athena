const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { encryptText } = require('../utils/crypto');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp4');
    cb(null, `evidence-${Date.now()}${ext}`);
  },
});

const upload = multer({ storage });
const router = express.Router();

router.post('/evidence/upload', authRequired, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async (req, res) => {
  try {
    const videoFile = req.files?.video?.[0];
    const audioFile = req.files?.audio?.[0];

    if (!videoFile && !audioFile) {
      return res.status(400).json({ message: 'Video or audio evidence is required' });
    }

    const latitude = req.body?.latitude ? Number(req.body.latitude) : null;
    const longitude = req.body?.longitude ? Number(req.body.longitude) : null;
    const encryptedMeta = encryptText(JSON.stringify({ latitude, longitude, capturedAt: new Date().toISOString() }));

    await db.query(
      `INSERT INTO evidence (user_id, video_path, audio_path, meta_encrypted)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, videoFile?.path || null, audioFile?.path || null, encryptedMeta]
    );

    return res.status(201).json({
      message: 'Evidence uploaded',
      videoPath: videoFile?.path || null,
      audioPath: audioFile?.path || null,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to upload evidence', error: error.message });
  }
});

module.exports = router;
