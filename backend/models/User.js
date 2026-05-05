const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobileNumber: { type: String, required: true, unique: true },
  otpCode:      { type: String },
  otpExpiresAt: { type: Date },
  verified:     { type: Boolean, default: false },
  sessionToken: { type: String },
  strikes:      { type: Number, default: 0 },
  lockoutUntil: { type: Date, default: null },
}, { timestamps: true, collection: 'users' });

userSchema.index({ mobileNumber: 1 });
userSchema.index({ sessionToken: 1 }, { sparse: true });

module.exports = mongoose.model('User', userSchema);
