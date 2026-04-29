const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
  if (connected) return;

  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/parkingDB';

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 30000,
      retryWrites: true,
    });
    connected = true;
    console.log(`[DB] Connected → ${uri}`);
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    connected = false;
    console.warn('[DB] Disconnected from MongoDB');
  });
}

module.exports = { connectDB };
