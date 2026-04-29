require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { connectDB } = require('./config/db');

const authRoutes    = require('./routes/auth');
const parkingRoutes = require('./routes/parking');
const staffRoutes   = require('./routes/staff');

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  message: { error: 'Too many requests – slow down.' },
}));

app.use('/api/auth',    authRoutes);
app.use('/api/parking', parkingRoutes);
app.use('/api/staff',   staffRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`[API] Listening on port ${PORT}`));
});
