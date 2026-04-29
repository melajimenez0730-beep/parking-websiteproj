const mongoose = require('mongoose');

// floor_number is the shard key – every query that includes it
// routes to exactly one shard without scatter-gather overhead.
const spotSchema = new mongoose.Schema(
  {
    spotId:       { type: String, required: true, unique: true },
    floor_number: { type: Number, required: true, index: true }, // SHARD KEY
    row:          { type: Number, required: true },
    col:          { type: Number, required: true },
    spotNum:      { type: Number, required: true },

    status: {
      type: String,
      enum: ['available', 'soft_locked', 'reserved', 'occupied'],
      default: 'available',
    },

    features: [{ type: String }], // entrance | exit | grocery | disability

    vehicle: {
      plate: String,
      type:  { type: String }, // escape Mongoose 'type' keyword conflict
      owner: String,
    },

    // Soft-lock: holds the spot for 3 minutes during checkout
    softLock: {
      userId:    String,
      lockId:    String,
      expiresAt: Date,
    },

    reservedAt: Date,
    reservedBy: String,
    occupiedAt: Date,

    // Optimistic Concurrency Control version counter
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'spots' }
);

spotSchema.index({ floor_number: 1, status: 1 });
spotSchema.index({ floor_number: 1, spotNum: 1 }, { unique: true });
spotSchema.index({ 'softLock.expiresAt': 1 }, { sparse: true });

module.exports = mongoose.model('ParkingSpot', spotSchema);
