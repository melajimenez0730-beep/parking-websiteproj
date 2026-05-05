require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose    = require('mongoose');
const ParkingSpot = require('../models/ParkingSpot');

const URI = process.env.MONGO_URI || 'mongodb://localhost:27017/parkingDB';

const ISLANDS         = ['A', 'B', 'C', 'D', 'E', 'F'];
const SPOTS_PER_ROW   = 18;
const ROWS_PER_ISLAND = 2;
const SPOTS_PER_ISLAND = SPOTS_PER_ROW * ROWS_PER_ISLAND;

function getFeatures(spotNum, islandIdx, row, col) {
  const features = [];
  if (islandIdx === 0)                     features.push('entrance');
  if (islandIdx === 5)                     features.push('exit');
  if (islandIdx === 2 || islandIdx === 3)  features.push('grocery');
  // PWD: Island D, left column (col 1-2), top row — adjacent to Mall Entrance aisle
  if (islandIdx === 3 && row === 1 && col <= 2) features.push('disability');
  return features;
}

function getSpotType(floor, spotNum, islandIdx, row, col) {
  // PWD: Island D, left column (col 1-2), row 1 — closest to Mall Entrance
  if (islandIdx === 3 && row === 1 && col <= 2)                return 'PWD';
  // Motorcycle zone: Floor 1 only, Island A (islandIdx 0), first row, cols 3–18
  if (floor === 1 && islandIdx === 0 && row === 1 && col >= 3) return 'Motorcycle';
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
          const type    = getSpotType(floor, spotNum, islandIdx, row, col);

          spots.push({
            spotId,
            floor_number: floor,
            spotNum,
            row,
            col,
            spotType: type,
            status:   'available',
            features: getFeatures(spotNum, islandIdx, row, col),
            version:  0,
          });
        }
      }
    }
  }

  await ParkingSpot.insertMany(spots);
  const perFloor = ISLANDS.length * SPOTS_PER_ISLAND;
  console.log(`Seeded ${spots.length} spots (${perFloor} per floor × 3 floors)`);
  console.log(`  PWD spots: Island D col 1-2 (row 1) on all floors — adjacent to Mall Entrance`);
  console.log(`  Motorcycle zone: Floor 1, Island A, row 1 cols 3-18`);

  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
