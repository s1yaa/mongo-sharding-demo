// ==========================================
// MongoDB Range-Based Sharding Demo Script
// Can be executed in mongosh:
//   docker exec -i mongos mongosh < commands.js
// ==========================================

// 1. Add Shards to Cluster & Verify
print("=== Step 1: Add Shards ===");
printjson(sh.addShard("shardA/shardA1:27017"));
printjson(sh.addShard("shardB/shardB1:27017"));
printjson(sh.listShards());

// 2. Verify Router Identity (mongos returns msg: 'isdbgrid')
print("\n=== Step 2: mongos Hello Check ===");
printjson(db.adminCommand({ hello: 1 }));

// 3. Enable Sharding on Database
print("\n=== Step 3: Enable Sharding for CollegeDB ===");
printjson(sh.enableSharding("CollegeDB"));

// 4. Shard the Collection with Normal Ascending Range Key
print("\n=== Step 4: Shard Collection CollegeDB.students ===");
printjson(sh.shardCollection("CollegeDB.students", { student_id: 1 }));

// 5. Insert 8 Sample Documents
print("\n=== Step 5: Insert Documents ===");
const students = [
  { student_id: 101, name: "Rahul", department: "CSE" },
  { student_id: 102, name: "Priya", department: "IT" },
  { student_id: 103, name: "Amit", department: "ECE" },
  { student_id: 104, name: "Sneha", department: "CSE" },
  { student_id: 105, name: "Arjun", department: "IT" },
  { student_id: 201, name: "Neha", department: "ECE" },
  { student_id: 202, name: "Rohan", department: "CSE" },
  { student_id: 203, name: "Ananya", department: "IT" }
];
printjson(db.getSiblingDB("CollegeDB").students.insertMany(students));

// 6. Status and Distribution Before Split (1 Chunk)
print("\n=== Step 6: Initial Sharding Status & Distribution ===");
sh.status();
db.getSiblingDB("CollegeDB").students.getShardDistribution();

// 7. Split Chunk at student_id: 200
print("\n=== Step 7: Split Chunk at 200 ===");
printjson(sh.splitAt("CollegeDB.students", { student_id: 200 }));

// 8. Move Upper Chunk [200, MaxKey) to the Other Shard Dynamically
print("\n=== Step 8: Move Upper Chunk to the Other Shard ===");
const coll = db.getSiblingDB("config").collections.findOne({ _id: "CollegeDB.students" });
const chunk = db.getSiblingDB("config").chunks.findOne({
  uuid: coll.uuid,
  "min.student_id": 200
});
const currentShard = chunk.shard;
const allShards = db.getSiblingDB("config").shards.find().toArray();
const targetShard = allShards.find(s => s._id !== currentShard)._id;

print(`Upper chunk [200, MaxKey) is on '${currentShard}'. Moving to '${targetShard}'...`);
printjson(sh.moveChunk("CollegeDB.students", { student_id: 200 }, targetShard));

// 9. Status and Distribution After Split and Move (2 Chunks Across 2 Shards)
print("\n=== Step 9: Sharding Status & Distribution After Move ===");
sh.status();
db.getSiblingDB("CollegeDB").students.getShardDistribution();

// 10. Query Planning: Single-Shard vs Boundary vs Multi-Shard
print("\n=== Step 10: Query Planning & Execution ===");

print("\n--- A. Range [100, 199] strictly in Chunk 1: ---");
print("Stage:", db.getSiblingDB("CollegeDB").students.find({ student_id: { $gte: 100, $lte: 199 } }).explain().queryPlanner.winningPlan.stage);

print("\n--- B. Range [100, 200] (reaches chunk boundary at 200): ---");
printjson(db.getSiblingDB("CollegeDB").students.find({ student_id: { $gte: 100, $lte: 200 } }).toArray());
print("Stage:", db.getSiblingDB("CollegeDB").students.find({ student_id: { $gte: 100, $lte: 200 } }).explain().queryPlanner.winningPlan.stage);

print("\n--- C. Range [100, 300] spanning both chunks: ---");
printjson(db.getSiblingDB("CollegeDB").students.find({ student_id: { $gte: 100, $lte: 300 } }).toArray());
print("Stage:", db.getSiblingDB("CollegeDB").students.find({ student_id: { $gte: 100, $lte: 300 } }).explain().queryPlanner.winningPlan.stage);
