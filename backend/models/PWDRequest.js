const mongoose = require('mongoose');

const pwdRequestSchema = new mongoose.Schema({
  requestId:    { type: String, required: true, unique: true },
  spotId:       { type: String, required: true },
  floor_number: Number,
  spotNum:      Number,
  mobileNumber: { type: String, required: true },
  action:       { type: String, enum: ['reserve', 'park_now'], default: 'reserve' },
  vehicleInfo:  { type: Object, default: {} },
  idFront:      String,
  idBack:       String,
  status:       { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
  lockId:       String,
  userId:       String,
  expiresAt:    { type: Date, required: true },
}, { timestamps: true });

pwdRequestSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('PWDRequest', pwdRequestSchema);
