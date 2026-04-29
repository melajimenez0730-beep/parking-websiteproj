const express    = require('express');
const { v4: uuid } = require('uuid');
const router     = express.Router();
const ParkingSpot  = require('../models/ParkingSpot');
const Transaction  = require('../models/Transaction');
const { authenticateStaff } = require('../middleware/auth');

router.use(authenticateStaff);

// ── GET /api/staff/overview ──────────────────────────────────────────────────
// Scatter-gather across all 3 shards via mongos aggregation
router.get('/overview', async (req, res) => {
  try {
    const floorStats = await ParkingSpot.aggregate([
      { $group: { _id: { floor: '$floor_number', status: '$status' }, count: { $sum: 1 } } },
      { $group: { _id: '$_id.floor', statuses: { $push: { k: '$_id.status', v: '$count' } }, total: { $sum: '$count' } } },
      { $sort: { _id: 1 } },
    ]);

    let totalAvailable = 0, totalReserved = 0, totalOccupied = 0, totalSoftLocked = 0;
    const byFloor = {};

    for (const f of floorStats) {
      const map = Object.fromEntries(f.statuses.map(s => [s.k, s.v]));
      byFloor[`floor${f._id}`] = {
        available:   map.available   || 0,
        soft_locked: map.soft_locked || 0,
        reserved:    map.reserved    || 0,
        occupied:    map.occupied    || 0,
        total:       f.total,
      };
      totalAvailable  += map.available   || 0;
      totalSoftLocked += map.soft_locked || 0;
      totalReserved   += map.reserved    || 0;
      totalOccupied   += map.occupied    || 0;
    }

    res.json({ totalSpots: 36, available: totalAvailable, softLocked: totalSoftLocked, reserved: totalReserved, occupied: totalOccupied, byFloor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to aggregate overview' });
  }
});

// ── GET /api/staff/transactions/export  (must be before /transactions route) ─
router.get('/transactions/export', async (req, res) => {
  try {
    const filter = {};
    if (req.query.floor)    filter.floor_number = parseInt(req.query.floor);
    if (req.query.type)     filter.type = req.query.type;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.timestamp = {};
      if (req.query.dateFrom) filter.timestamp.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) {
        const d = new Date(req.query.dateTo);
        d.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = d;
      }
    }

    const txns = await Transaction.find(filter).sort({ timestamp: -1 }).limit(5000);

    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ['Transaction ID','Floor','Spot','Type','Owner','Plate','Vehicle Type','Notes','Timestamp'].join(',');
    const rows   = txns.map(t => [
      esc(t.transactionId),
      esc(t.floor_number),
      esc(`P${String(t.spotNum || 0).padStart(2, '0')}`),
      esc(t.type),
      esc(t.vehicle?.owner),
      esc(t.vehicle?.plate),
      esc(t.vehicle?.type),
      esc(t.notes),
      esc(t.timestamp ? new Date(t.timestamp).toISOString() : ''),
    ].join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="parksmart-transactions.csv"');
    res.send([header, ...rows].join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── GET /api/staff/transactions?page&limit&floor&type&dateFrom&dateTo ─────────
router.get('/transactions', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.floor) filter.floor_number = parseInt(req.query.floor);
    if (req.query.type)  filter.type = req.query.type;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.timestamp = {};
      if (req.query.dateFrom) filter.timestamp.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) {
        const d = new Date(req.query.dateTo);
        d.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = d;
      }
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(filter),
    ]);

    res.json({ transactions, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ── GET /api/staff/spots?floor= ──────────────────────────────────────────────
router.get('/spots', async (req, res) => {
  try {
    const filter = req.query.floor ? { floor_number: parseInt(req.query.floor) } : {};
    const spots  = await ParkingSpot.find(filter).sort({ floor_number: 1, spotNum: 1 });
    res.json(spots);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch spots' });
  }
});

// ── PATCH /api/staff/spots/:spotId  — manual status override ─────────────────
router.patch('/spots/:spotId', async (req, res) => {
  const { spotId } = req.params;
  const { status, notes } = req.body || {};

  if (!['available', 'reserved', 'occupied'].includes(status)) {
    return res.status(400).json({ error: 'Status must be: available, reserved, or occupied' });
  }

  try {
    const spot = await ParkingSpot.findOne({ spotId });
    if (!spot) return res.status(404).json({ error: 'Spot not found' });

    const prevStatus = spot.status;
    const updates    = { status };

    if (status === 'available') {
      Object.assign(updates, { vehicle: null, softLock: null, reservedAt: null, reservedBy: null, occupiedAt: null });
    } else if (status === 'occupied') {
      Object.assign(updates, { occupiedAt: new Date(), softLock: null });
    } else if (status === 'reserved') {
      Object.assign(updates, { reservedAt: new Date(), reservedBy: 'staff', softLock: null });
    }

    const updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version },
      { $set: updates, $inc: { version: 1 } },
      { new: true }
    );

    if (!updated) return res.status(409).json({ error: 'Conflict detected, please retry' });

    const txnType = status === 'available' ? 'release' : status === 'occupied' ? 'occupy' : 'reserve';

    await Transaction.create({
      transactionId: uuid(),
      floor_number:  spot.floor_number,
      spotId,
      spotNum:       spot.spotNum,
      type:          txnType,
      userId:        'staff',
      notes:         notes || `Staff changed status from ${prevStatus} → ${status}`,
    });

    res.json({ success: true, spot: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update spot status' });
  }
});

// ── GET /api/staff/analytics ─────────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24 h

    const [hourlyData, typeStats, currentStatus] = await Promise.all([
      Transaction.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: { $hour: '$timestamp' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      ParkingSpot.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const totalTransactions = await Transaction.countDocuments();

    res.json({ hourlyData, typeStats, currentStatus, totalTransactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Analytics failed' });
  }
});

module.exports = router;
