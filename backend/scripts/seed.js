require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose    = require('mongoose');
const ParkingSpot = require('../models/ParkingSpot');

const URI = process.env.MONGO_URI || 'mongodb://localhost:27017/parkingDB';

const ISLANDS         = ['A', 'B', 'C', 'D', 'E', 'F'];
const SPOTS_PER_ROW   = 18;
const ROWS_PER_ISLAND = 2;
const SPOTS_PER_ISLAND = SPOTS_PER_ROW * ROWS_PER_ISLAND;

function getFeatures(spotNum, islandIdx) {
  const features = [];
  if (islandIdx === 0)                     features.push('entrance');
  if (islandIdx === 5)                     features.push('exit');
  if (islandIdx === 2 || islandIdx === 3)  features.push('grocery');
  if (spotNum <= 2)                        features.push('disability');
  return features;
}

function getSpotType(floor, spotNum, islandIdx, row) {
  if (spotNum <= 2)                                           return 'PWD';
  // Motorcycle zone: Floor 1 only, Island A (islandIdx 0), first row (1–18), spots 3–18
  if (floor === 1 && islandIdx === 0 && row === 1 && spotNum >= 3 && spotNum <= 18) return 'Motorcycle';
  return 'Standard';
}

async function seed() {
  await mongoose.connect(URI);
  console.log('Connected to MongoDB');

  await ParkingSpot.deleteMany({});

  const spots = [];
  for (let floor = 1; floor <= 3; floor++) {
    for (let islandIdx = 0; islandIdx < ISLANDS.length; islandIdx++) {
      for (let row = 1; row <= ROWS_PER_ISLAND; row++) {
        for (let col = 1; col <= SPOTS_PER_ROW; col++) {
          const spotNum = islandIdx * SPOTS_PER_ISLAND + (row - 1) * SPOTS_PER_ROW + col;
          const spotId  = `${floor}-P${String(spotNum).padStart(3, '0')}`;
          const type    = getSpotType(floor, spotNum, islandIdx, row);

          spots.push({
            spotId,
            floor_number: floor,
            spotNum,
            row,
            col,
            spotType: type,
            status:   'available',
            features: getFeatures(spotNum, islandIdx),
            version:  0,
          });
        }
      }
    }
  }

  await ParkingSpot.insertMany(spots);
  const perFloor = ISLANDS.length * SPOTS_PER_ISLAND;
  console.log(`Seeded ${spots.length} spots (${perFloor} per floor × 3 floors)`);
  console.log(`  PWD spots: 1-2 on all floors`);
  console.log(`  Motorcycle zone: Floor 1, Island A, spots 3-18`);

  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
