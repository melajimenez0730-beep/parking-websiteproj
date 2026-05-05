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
      enum: ['available', 'soft_locked', 'reserved', 'occupied'],
      default: 'available',
    },

    features: [{ type: String }],

    vehicle: {
      plate: String,
      type:  { type: String },
      owner: String,
    },

    softLock: {
      userId:       String,
      lockId:       String,
      expiresAt:    Date,
      mobileNumber: String,
    },

    reservedAt: Date,
    reservedBy: String,
    occupiedAt: Date,

    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'spots' }
);

spotSchema.index({ floor_number: 1, status: 1 });
spotSchema.index({ floor_number: 1, spotNum: 1 }, { unique: true });
spotSchema.index({ 'softLock.expiresAt': 1 }, { sparse: true });

module.exports = mongoose.model('ParkingSpot', spotSchema);
