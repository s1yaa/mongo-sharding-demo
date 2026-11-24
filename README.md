# MongoDB Range-Based Sharding Assignment Demo

This project sets up a local two-shard MongoDB 7.0 cluster with Docker Compose, demonstrates range-based sharding on a sample collection (`CollegeDB.students`), splits and migrates chunks across shards, and analyzes single-shard vs. multi-shard query execution plans.

---

## 1. Cluster Architecture

| Component | Container Name | Service Role | Internal Address | Host Port | Replica Set Name |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Config Server** | `cfg1` | Cluster metadata & catalog | `cfg1:27017` | - | `cfgrs` (single-node) |
| **Shard A** | `shardA1` | Data shard A | `shardA1:27017` | - | `shardA` (single-node) |
| **Shard B** | `shardB1` | Data shard B | `shardB1:27017` | - | `shardB` (single-node) |
| **Router** | `mongos` | Query router & balancer | `mongos:27017` | `localhost:27017` | N/A |

All containers are connected via a dedicated Docker bridge network (`mongo-sharding-net`).

---

## 2. Cluster Lifecycle Commands

### Starting the Cluster from Scratch
```bash
# Prepend Docker CLI path if not in default PATH
export PATH="$HOME/.docker/bin:$PATH"

# 1. Start config server and shard nodes
docker compose up -d cfg1 shardA1 shardB1

# 2. Initiate replica sets
docker exec cfg1 mongosh --quiet --eval 'rs.initiate({_id: "cfgrs", configsvr: true, members: [{_id: 0, host: "cfg1:27017"}]})'
docker exec shardA1 mongosh --quiet --eval 'rs.initiate({_id: "shardA", members: [{_id: 0, host: "shardA1:27017"}]})'
docker exec shardB1 mongosh --quiet --eval 'rs.initiate({_id: "shardB", members: [{_id: 0, host: "shardB1:27017"}]})'

# 3. Wait for all nodes to achieve PRIMARY role
docker exec cfg1 mongosh --quiet --eval 'rs.status().members[0].stateStr'
docker exec shardA1 mongosh --quiet --eval 'rs.status().members[0].stateStr'
docker exec shardB1 mongosh --quiet --eval 'rs.status().members[0].stateStr'

# 4. Start mongos router
docker compose up -d mongos

# 5. Connect to mongos and run commands script
docker exec -i mongos mongosh < commands.js
```

### Resetting and Wiping the Cluster
To completely shut down all containers, destroy network bindings, and wipe all database volumes:
```bash
docker compose down -v
```

---

## 3. Command Reference & Purpose

| Command | Context | One-line Purpose |
| :--- | :--- | :--- |
| `rs.initiate({_id: "cfgrs", configsvr: true, ...})` | `cfg1` | Initiates the config server replica set with metadata catalog capabilities. |
| `rs.initiate({_id: "shardA", ...})` | `shardA1` | Initiates single-node replica set for Shard A. |
| `rs.initiate({_id: "shardB", ...})` | `shardB1` | Initiates single-node replica set for Shard B. |
| `rs.status()` | All nodes | Polls replica set topology to verify member election to `PRIMARY`. |
| `mongos --configdb cfgrs/cfg1:27017` | `mongos` | Boots query router connected to config replica set. |
| `sh.addShard("shardA/shardA1:27017")` | `mongos` | Registers Shard A replica set as a storage shard. |
| `sh.addShard("shardB/shardB1:27017")` | `mongos` | Registers Shard B replica set as a storage shard. |
| `sh.listShards()` | `mongos` | Lists all active shards in the cluster catalog. |
| `db.adminCommand({hello: 1})` | `mongos` | Verifies router connection and confirms `msg: 'isdbgrid'`. |
| `sh.enableSharding("CollegeDB")` | `mongos` | Enables sharding on the database `CollegeDB`. |
| `sh.shardCollection("CollegeDB.students", {student_id: 1})` | `mongos` | Shards the collection using a range-based ascending shard key on `student_id`. |
| `db.students.insertMany([...])` | `mongos` | Populates 8 sample student documents into `CollegeDB.students`. |
| `sh.status()` | `mongos` | Inspects full cluster layout, primary shard, chunk ranges, and balancing status. |
| `db.students.getShardDistribution()` | `mongos` | Reports collection data size, document counts, and chunk distribution per shard. |
| `sh.splitAt("CollegeDB.students", {student_id: 200})` | `mongos` | Splits the initial monolithic chunk into `[MinKey, 200)` and `[200, MaxKey)`. |
| `sh.moveChunk("CollegeDB.students", {student_id: 200}, targetShard)` | `mongos` | Migrates the upper chunk `[200, MaxKey)` to the destination shard. |
| `db.students.find({student_id: {$gte: 100, $lte: 200}})` | `mongos` | Queries documents with student IDs between 100 and 200. |
| `.explain().queryPlanner.winningPlan.stage` | `mongos` | Evaluates whether query is routed to a single shard (`SINGLE_SHARD`) or merged (`SHARD_MERGE`). |

---

## 4. Expected vs. Observed Output & Diagnostics

### Setup: Docker Environment
- **Expected**: `docker --version` succeeds.
- **Observed**: Shell returned `command not found: docker`.
- **Diagnosis**: Docker Desktop was installed under `/Applications/Docker.app`, and its symlinks were placed in `~/.docker/bin`, which was not in the default non-interactive shell `PATH`.
- **Resolution**: Prepending `export PATH="$HOME/.docker/bin:$PATH"` enabled access to `docker` (v29.9.3) and `docker compose` (v2.40.3).

---

### Step 1: `sh.addShard()` & `sh.listShards()`
- **Output File**: `outputs/01-listShards.txt`
- **Expected**: Both shards added with `{ ok: 1 }` and `sh.listShards()` returns array with `shardA` and `shardB`.
- **Observed**: Exactly as expected. Shard IDs `shardA` and `shardB` both reported `state: 1`.

---

### Step 2: `db.adminCommand({hello: 1})`
- **Output File**: `outputs/02-hello-mongos.txt`
- **Expected**: Output contains `isWritablePrimary: true` and `msg: 'isdbgrid'`.
- **Observed**: Output returned `{ isWritablePrimary: true, msg: 'isdbgrid', ok: 1 }`. Confirms direct connection to `mongos`.

---

### Step 3: `sh.enableSharding("CollegeDB")`
- **Output File**: `outputs/03-enableSharding.txt`
- **Expected**: `{ ok: 1 }`.
- **Observed**: Exactly as expected (`{ ok: 1 }`).

---

### Step 4: `sh.shardCollection()` & Insert Documents
- **Output File**: `outputs/04-shardCollection.txt`
- **Expected**: Sharding succeeds with range key `{student_id: 1}`; 8 documents inserted.
- **Observed**: Returned `{ collectionsharded: 'CollegeDB.students', ok: 1 }`. All 8 documents inserted and verified.

---

### Step 5: `sh.status()` & `getShardDistribution()` (Before Split)
- **Output File**: `outputs/05-status-before.txt`
- **Expected**: 1 chunk spanning `[MinKey, MaxKey)` on the primary shard (`shardB`), holding 100% of data (8 documents).
- **Observed**: Exactly as expected. Primary shard was assigned as `shardB`. Single chunk on `shardB` with 8 documents and 588 bytes.

---

### Step 6: `sh.splitAt("CollegeDB.students", {student_id: 200})`
- **Output File**: `outputs/06-splitAt.txt`
- **Expected**: `{ ok: 1 }`, creating two chunks: `[MinKey, 200)` and `[200, MaxKey)` on `shardB`.
- **Observed**: Returned `{ ok: 1 }`. Inspection of `config.chunks` confirmed two distinct chunk records.

---

### Step 7: Dynamic Chunk Discovery & `sh.moveChunk()`
- **Output File**: `outputs/07-moveChunk.txt`
- **Expected**: Identify that `[200, MaxKey)` is on `shardB`, and move it to `shardA` without hardcoding shard names.
- **Observed**: Script queried `config.chunks` and `config.shards`. Detected `currentShard = shardB`, computed `targetShard = shardA`, and executed `sh.moveChunk()`. Completed in 198ms with `{ ok: 1 }`.

---

### Step 8: `sh.status()` & `getShardDistribution()` (After Split & Move)
- **Output File**: `outputs/08-status-after.txt`
- **Expected**: 5 documents on one shard (`< 200`) and 3 documents on the other (`>= 200`).
- **Observed**:
  - `sh.status()` under `shardedDataDistribution`:
    - `shardA`: `numOwnedDocuments: 3` (IDs: 201, 202, 203)
    - `shardB`: `numOwnedDocuments: 5` (IDs: 101, 102, 103, 104, 105)
  - *Technical Nuance on `getShardDistribution()`*: In MongoDB, `getShardDistribution()` queries storage engine `collStats()` on each shard. Right after chunk migration, the donor shard (`shardB`) marks the 3 transferred documents as orphaned (`numOrphanedDocs: 3`) while the asynchronous background range deletion task waits to prune them (`whenToClean: 'delayed'`). `sh.status()` reflects the exact owned document count (5 on shardB and 3 on shardA).

---

### Step 9: Query `find({student_id: {$gte: 100, $lte: 200}})` & Explain Plan
- **Output File**: `outputs/09-explain-single-shard.txt`
- **Expected**: Single shard query (`SINGLE_SHARD`).
- **Observed**: **`SHARD_MERGE`**!
- **Diagnosis & Explanation**:
  - Chunk boundaries:
    - Chunk 1: `[MinKey, 200)` on `shardB`
    - Chunk 2: `[200, MaxKey)` on `shardA`
  - In MongoDB range sharding, chunk boundaries are half-open intervals `[min, max)` where `min` is inclusive and `max` is exclusive.
  - The query specifies `$lte: 200`, which **includes 200**.
  - Because 200 is the exact lower bound of Chunk 2 (`[200, MaxKey)`), the query range `[100, 200]` intersects **both** Chunk 1 on `shardB` (for values 100-199) and Chunk 2 on `shardA` (for value 200).
  - Therefore, `mongos` must route the query to both shards and merge the results (`SHARD_MERGE`).
  - **Verification**: When querying strictly inside Chunk 1 with `db.students.find({student_id: {$gte: 100, $lte: 199}})`, the winning plan stage is **`SINGLE_SHARD`** (routed solely to `shardB`). Both explain plans are recorded in `outputs/09-explain-single-shard.txt`.

---

### Step 10: Query `find({student_id: {$gte: 100, $lte: 300}})` & Explain Plan
- **Output File**: `outputs/10-explain-shard-merge.txt`
- **Expected**: `SHARD_MERGE`.
- **Observed**: **`SHARD_MERGE`** exactly as expected. The query interval `[100, 300]` spans both chunks, requiring `mongos` to query both `shardA` and `shardB` via `IXSCAN` and merge the documents.
