const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'changeme_in_production_32chars';

function authenticateStaff(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(header.slice(7), SECRET);

    if (payload.role !== 'staff' && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient privileges' });
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticateStaff };
