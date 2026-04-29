const mongoose = require('mongoose');

// floor_number is also the shard key here so transaction writes
// land on the same shard as the corresponding spot document.
// The staff dashboard does a scatter-gather across all 3 shards
// to produce the unified transaction log.
const transactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    floor_number:  { type: Number, required: true, index: true }, // SHARD KEY

    spotId:  { type: String, required: true },
    spotNum: { type: Number, required: true },

    type: {
      type: String,
      enum: ['soft_lock', 'reserve', 'occupy', 'release', 'expire'],
      required: true,
    },

    vehicle: {
      plate: String,
      type:  { type: String }, // escape Mongoose 'type' keyword conflict
      owner: String,
    },

    userId:          String,
    timestamp:       { type: Date, default: Date.now },
    durationMinutes: Number,
    fee:             Number,
    notes:           String,
  },
  { collection: 'transactions' }
);

transactionSchema.index({ floor_number: 1, timestamp: -1 });
transactionSchema.index({ spotId: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
