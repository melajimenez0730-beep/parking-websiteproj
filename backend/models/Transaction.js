const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    floor_number:  { type: Number, required: true, index: true },

    spotId:  { type: String, required: true },
    spotNum: { type: Number, required: true },

    type: {
      type: String,
      enum: ['soft_lock', 'reserve', 'occupy', 'release', 'expire', 'park_now'],
      required: true,
    },

    vehicle: {
      plate: String,
      type:  { type: String },
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
