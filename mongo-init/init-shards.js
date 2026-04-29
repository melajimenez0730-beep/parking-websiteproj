// ═══════════════════════════════════════════════════════════════════
//  MongoDB Sharding Initializer
//  Run via: mongosh --host mongos:27017 init-shards.js
//
//  Sharding design:
//    Shard Key  : floor_number  (range-based)
//    Zone 1     : floor_number = 1  →  shard1
//    Zone 2     : floor_number = 2  →  shard2
//    Zone 3     : floor_number = 3  →  shard3
//
//  This ensures every read/write for a given floor hits exactly
//  one shard — no fan-out for single-floor queries. Cross-floor
//  aggregations (staff dashboard) are scatter-gathered by mongos.
// ═══════════════════════════════════════════════════════════════════

// ─── Step 1: Register shards with the cluster ──────────────────
sh.addShard("shard1ReplSet/shard1:27018");
sh.addShard("shard2ReplSet/shard2:27018");
sh.addShard("shard3ReplSet/shard3:27018");

print("✔ Shards registered");

// ─── Step 2: Enable sharding on the database ───────────────────
sh.enableSharding("parkingDB");

print("✔ Sharding enabled on parkingDB");

// ─── Step 3: Shard the collections on floor_number ─────────────
sh.shardCollection("parkingDB.spots",        { floor_number: 1 });
sh.shardCollection("parkingDB.transactions", { floor_number: 1 });

print("✔ Collections sharded on floor_number");

// ─── Step 4: Define zones (one per floor level) ────────────────
sh.addShardToZone("shard1ReplSet/shard1:27018", "zone_floor1");
sh.addShardToZone("shard2ReplSet/shard2:27018", "zone_floor2");
sh.addShardToZone("shard3ReplSet/shard3:27018", "zone_floor3");

print("✔ Zones created");

// ─── Step 5: Assign key ranges to zones ────────────────────────
// Range [MinKey, 2)  → zone_floor1  (floor_number = 1)
sh.updateZoneKeyRange("parkingDB.spots",
  { floor_number: MinKey }, { floor_number: 2 }, "zone_floor1");

// Range [2, 3)       → zone_floor2  (floor_number = 2)
sh.updateZoneKeyRange("parkingDB.spots",
  { floor_number: 2 }, { floor_number: 3 }, "zone_floor2");

// Range [3, MaxKey)  → zone_floor3  (floor_number = 3)
sh.updateZoneKeyRange("parkingDB.spots",
  { floor_number: 3 }, { floor_number: MaxKey }, "zone_floor3");

// Same ranges for transactions
sh.updateZoneKeyRange("parkingDB.transactions",
  { floor_number: MinKey }, { floor_number: 2 }, "zone_floor1");
sh.updateZoneKeyRange("parkingDB.transactions",
  { floor_number: 2 }, { floor_number: 3 }, "zone_floor2");
sh.updateZoneKeyRange("parkingDB.transactions",
  { floor_number: 3 }, { floor_number: MaxKey }, "zone_floor3");

print("✔ Zone key ranges assigned");

// ─── Step 6: Seed 36 parking spots (12 per floor) ──────────────
//  Grid layout (3 rows × 4 cols):
//    [P01][P02][P03][P04]   ← Row 1 (nearest entrance)
//    [P05][P06][P07][P08]   ← Row 2 (middle)
//    [P09][P10][P11][P12]   ← Row 3 (exit / grocery end)
//
//  Special features:
//    P01, P02 → entrance     P03, P04 → entrance + disability
//    P09, P10 → exit         P11, P12 → grocery

const SPOT_FEATURES = {
  1: ["entrance"],
  2: ["entrance"],
  3: ["entrance", "disability"],
  4: ["entrance", "disability"],
  5: [],
  6: [],
  7: [],
  8: [],
  9:  ["exit"],
  10: ["exit"],
  11: ["grocery"],
  12: ["grocery"],
};

const spots = [];
const now = new Date();

for (let floor = 1; floor <= 3; floor++) {
  for (let num = 1; num <= 12; num++) {
    spots.push({
      spotId:       `${floor}-P${String(num).padStart(2, "0")}`,
      floor_number: floor,
      row:          Math.ceil(num / 4),
      col:          ((num - 1) % 4) + 1,
      spotNum:      num,
      status:       "available",
      features:     SPOT_FEATURES[num] || [],
      vehicle:      null,
      softLock:     null,
      reservedAt:   null,
      reservedBy:   null,
      occupiedAt:   null,
      version:      0,
      createdAt:    now,
      updatedAt:    now,
    });
  }
}

db = db.getSiblingDB("parkingDB");
db.spots.deleteMany({});
db.spots.insertMany(spots);

// Create indexes
db.spots.createIndex({ floor_number: 1, status: 1 });
db.spots.createIndex({ floor_number: 1, spotNum: 1 }, { unique: true });
db.spots.createIndex({ spotId: 1 }, { unique: true });
db.spots.createIndex({ "softLock.expiresAt": 1 }, { sparse: true });

db.transactions.createIndex({ floor_number: 1, timestamp: -1 });
db.transactions.createIndex({ transactionId: 1 }, { unique: true });
db.transactions.createIndex({ spotId: 1, timestamp: -1 });

print("✔ Seeded 36 spots across 3 floors");
print("✔ Indexes created");
print("");
print("════════════════════════════════════════");
print("  Cluster ready:");
print("    Shard 1 (zone_floor1) → Floor 1");
print("    Shard 2 (zone_floor2) → Floor 2");
print("    Shard 3 (zone_floor3) → Floor 3");
print("════════════════════════════════════════");
