require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose   = require('mongoose');
const ParkingSpot = require('../models/ParkingSpot');

const URI = process.env.MONGO_URI || 'mongodb://localhost:27017/parkingDB';

const FEATURES = {
  1: ['entrance'],
  2: ['entrance'],
  3: ['entrance', 'disability'],
  4: ['entrance', 'disability'],
  5: [], 6: [], 7: [], 8: [],
  9:  ['exit'],
  10: ['exit'],
  11: ['grocery'],
  12: ['grocery'],
};

async function seed() {
  await mongoose.connect(URI);
  console.log('Connected to MongoDB');

  await ParkingSpot.deleteMany({});

  const spots = [];
  for (let floor = 1; floor <= 3; floor++) {
    for (let num = 1; num <= 12; num++) {
      spots.push({
        spotId:       `${floor}-P${String(num).padStart(2, '0')}`,
        floor_number: floor,
        row:          Math.ceil(num / 4),
        col:          ((num - 1) % 4) + 1,
        spotNum:      num,
        status:       'available',
        features:     FEATURES[num] || [],
        version:      0,
      });
    }
  }

  await ParkingSpot.insertMany(spots);
  console.log(`Seeded ${spots.length} spots (${spots.length / 3} per floor × 3 floors)`);

  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
