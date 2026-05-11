const express    = require('express');
const { v4: uuid } = require('uuid');
const router     = express.Router();
const ParkingSpot  = require('../models/ParkingSpot');
const Transaction  = require('../models/Transaction');
const PWDRequest   = require('../models/PWDRequest');
const { authenticateStaff } = require('../middleware/auth');

router.use(authenticateStaff);

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

router.get('/spots', async (req, res) => {
  try {
    const filter = req.query.floor ? { floor_number: parseInt(req.query.floor) } : {};
    const spots  = await ParkingSpot.find(filter).sort({ floor_number: 1, spotNum: 1 });
    res.json(spots);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch spots' });
  }
});

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

router.get('/analytics', async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

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

// GET /pwd-requests/count — pending count for badge polling
router.get('/pwd-requests/count', async (req, res) => {
  try {
    const count = await PWDRequest.countDocuments({ status: 'pending', expiresAt: { $gt: new Date() } });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

// GET /pwd-requests — pending requests not yet expired
router.get('/pwd-requests', async (req, res) => {
  try {
    const requests = await PWDRequest.find({ status: 'pending', expiresAt: { $gt: new Date() } }).sort({ createdAt: 1 });
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get PWD requests' });
  }
});

// POST /pwd-requests/:requestId/approve
router.post('/pwd-requests/:requestId/approve', async (req, res) => {
  const { requestId } = req.params;
  try {
    const pwdReq = await PWDRequest.findOne({ requestId });
    if (!pwdReq) return res.status(404).json({ error: 'PWD request not found' });
    if (pwdReq.status !== 'pending') return res.status(409).json({ error: `Request is already ${pwdReq.status}` });
    if (pwdReq.expiresAt < new Date()) {
      pwdReq.status = 'declined'; await pwdReq.save();
      return res.status(410).json({ error: 'PWD request has expired' });
    }

    const spot = await ParkingSpot.findOne({ spotId: pwdReq.spotId });
    if (!spot) return res.status(404).json({ error: 'Spot not found' });

    const vehicle    = pwdReq.vehicleInfo || {};
    const newStatus  = pwdReq.action === 'park_now' ? 'occupied' : 'reserved';
    const statusFields = pwdReq.action === 'park_now'
      ? { status: 'occupied', mobileNumber: pwdReq.mobileNumber, vehicle, occupiedAt: new Date(), softLock: null }
      : { status: 'reserved', mobileNumber: pwdReq.mobileNumber, vehicle, reservedAt: new Date(), reservedBy: vehicle.owner || pwdReq.mobileNumber, softLock: null };

    await ParkingSpot.findOneAndUpdate(
      { _id: spot._id, version: spot.version },
      { $set: statusFields, $inc: { version: 1 } }
    );

    pwdReq.status = 'approved';
    await pwdReq.save();

    await Transaction.create({
      transactionId: uuid(),
      floor_number:  spot.floor_number,
      spotId:        spot.spotId,
      spotNum:       spot.spotNum,
      type:          pwdReq.action === 'park_now' ? 'park_now' : 'reserve',
      vehicle,
      userId:        pwdReq.mobileNumber,
      notes:         'PWD ID verified by staff',
    });

    res.json({ success: true, newStatus });
  } catch (err) {
    console.error('[pwd-approve] ERROR:', err);
    res.status(500).json({ error: 'Failed to approve PWD request' });
  }
});

// POST /pwd-requests/:requestId/decline
router.post('/pwd-requests/:requestId/decline', async (req, res) => {
  const { requestId } = req.params;
  try {
    const pwdReq = await PWDRequest.findOne({ requestId });
    if (!pwdReq) return res.status(404).json({ error: 'PWD request not found' });
    if (pwdReq.status !== 'pending') return res.status(409).json({ error: `Request is already ${pwdReq.status}` });

    pwdReq.status = 'declined';
    await pwdReq.save();

    const spot = await ParkingSpot.findOne({ spotId: pwdReq.spotId });
    if (spot && spot.status === 'soft_locked' && spot.softLock?.lockId === pwdReq.lockId) {
      await ParkingSpot.findOneAndUpdate(
        { _id: spot._id, version: spot.version },
        { $set: { status: 'available', softLock: null, mobileNumber: null, vehicle: null }, $inc: { version: 1 } }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[pwd-decline] ERROR:', err);
    res.status(500).json({ error: 'Failed to decline PWD request' });
  }
});

module.exports = router;
