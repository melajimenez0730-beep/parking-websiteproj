const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const SECRET = process.env.JWT_SECRET   || 'changeme_in_production_32chars';
const VALID_USER = process.env.STAFF_USERNAME || 'admin';
const VALID_PASS = process.env.STAFF_PASSWORD || 'admin123';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username !== VALID_USER || password !== VALID_PASS) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ username, role: 'staff' }, SECRET, { expiresIn: '8h' });

  res.json({ token, role: 'staff', username });
});

// POST /api/auth/logout  (JWT is stateless – client discards the token)
router.post('/logout', (_req, res) => {
  res.json({ success: true });
});

// GET /api/auth/verify
router.get('/verify', (req, res) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) return res.json({ valid: false });

  try {
    const payload = jwt.verify(header.slice(7), SECRET);
    res.json({ valid: true, user: { username: payload.username, role: payload.role } });
  } catch {
    res.json({ valid: false });
  }
});

module.exports = router;
