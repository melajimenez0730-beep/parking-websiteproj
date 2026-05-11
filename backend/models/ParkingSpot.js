const mongoose = require('mongoose');

const spotSchema = new mongoose.Schema(
  {
    spotId:       { type: String, required: true, unique: true },
    floor_number: { type: Number, required: true, index: true },
    row:          { type: Number, required: true },
    col:          { type: Number, required: true },
    spotNum:      { type: Number, required: true },

    spotType: {
      type: String,
      enum: ['Standard', 'PWD', 'Motorcycle'],
      default: 'Standard',
    },

    status: {
      type: String,
      enum: ['available', 'soft_locked', 'reserved', 'occupied', 'exiting'],
      default: 'available',
    },

    features: [{ type: String }],

    vehicle: {
      plate: String,
      type:  { type: String },
      owner: String,
    },

    mobileNumber: { type: String, default: null },

    softLock: {
      userId:       String,
      lockId:       String,
      expiresAt:    Date,
      mobileNumber: String,
    },

    reservedAt: Date,
    reservedBy: String,
    occupiedAt: Date,
    exitingAt:  Date,

    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'spots' }
);

spotSchema.index({ floor_number: 1, status: 1 });
spotSchema.index({ floor_number: 1, spotNum: 1 }, { unique: true });
spotSchema.index({ 'softLock.expiresAt': 1 }, { sparse: true });

// Partial unique index: one mobile number can only hold ONE active spot at a time.
// Only enforced when status is active (soft_locked/reserved/occupied) AND mobileNumber is set.
// Released/available spots fall outside the index, so nulls and freed spots never conflict.
spotSchema.index(
  { mobileNumber: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      mobileNumber: { $type: 'string' },
      status: { $in: ['soft_locked', 'reserved', 'occupied'] },
    },
  }
);

module.exports = mongoose.model('ParkingSpot', spotSchema);
