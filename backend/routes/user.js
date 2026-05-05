const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const User = require('../models/User');

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isLocked(user) {
  return user.lockoutUntil && user.lockoutUntil > new Date();
}

// POST /api/user/register
// Creates or updates user, generates OTP. Returns otpCode in dev (remove for prod).
router.post('/register', async (req, res) => {
  const { mobileNumber } = req.body || {};
  if (!mobileNumber) return res.status(400).json({ error: 'mobileNumber is required' });
  if (!/^\+?\d{7,15}$/.test(mobileNumber.replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'Invalid mobile number format' });
  }

  try {
    let user = await User.findOne({ mobileNumber });

    if (user && isLocked(user)) {
      return res.status(403).json({
        error: 'Account is locked due to repeated no-shows.',
        lockoutUntil: user.lockoutUntil,
      });
    }

    const otpCode      = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    if (user) {
      user.otpCode      = otpCode;
      user.otpExpiresAt = otpExpiresAt;
      await user.save();
    } else {
      user = await User.create({ mobileNumber, otpCode, otpExpiresAt });
    }

    // In production: send SMS via Twilio or equivalent. Dev returns code directly.
    res.json({ message: 'OTP sent to your mobile number.', otpCode, expiresIn: 300 });
  } catch (err) {
    console.error('[user/register]', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// POST /api/user/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { mobileNumber, otpCode } = req.body || {};
  if (!mobileNumber || !otpCode) {
    return res.status(400).json({ error: 'mobileNumber and otpCode are required' });
  }

  try {
    const user = await User.findOne({ mobileNumber });
    if (!user) return res.status(404).json({ error: 'User not found. Please register first.' });

    if (!user.otpCode || user.otpCode !== String(otpCode)) {
      return res.status(401).json({ error: 'Invalid OTP.' });
    }
    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(401).json({ error: 'OTP has expired. Please request a new one.' });
    }

    const sessionToken    = uuid();
    user.verified         = true;
    user.otpCode          = null;
    user.otpExpiresAt     = null;
    user.sessionToken     = sessionToken;
    await user.save();

    res.json({ token: sessionToken, mobileNumber, strikes: user.strikes });
  } catch (err) {
    console.error('[user/verify-otp]', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

// GET /api/user/status?mobile=xxx
router.get('/status', async (req, res) => {
  const { mobile } = req.query;
  if (!mobile) return res.status(400).json({ error: 'mobile query param required' });

  try {
    const user = await User.findOne({ mobileNumber: mobile });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.json({
      mobileNumber: user.mobileNumber,
      strikes:      user.strikes,
      locked:       isLocked(user),
      lockoutUntil: user.lockoutUntil,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user status.' });
  }
});

// POST /api/user/strike
router.post('/strike', async (req, res) => {
  const { mobileNumber } = req.body || {};
  if (!mobileNumber) return res.status(400).json({ error: 'mobileNumber is required' });

  try {
    const user = await User.findOne({ mobileNumber });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.strikes += 1;
    if (user.strikes >= 3 && !isLocked(user)) {
      user.lockoutUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    await user.save();

    res.json({ strikes: user.strikes, locked: isLocked(user), lockoutUntil: user.lockoutUntil });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record strike.' });
  }
});

module.exports = router;
