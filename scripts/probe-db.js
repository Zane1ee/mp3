'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { databaseTarget, isolatedTestTarget } = require('../config/environment');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

async function probe(target, label) {
  const connection = await mongoose.createConnection(target.uri, {
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  let session;
  try {
    await connection.db.command({ ping: 1 });
    try {
      await connection.db.createCollection('users');
    } catch (error) {
      if (error.code !== 48) throw error;
    }
    const users = connection.db.collection('users');
    await users.createIndex({ email: 1 }, { unique: true });
    session = await connection.startSession();
    const tag = randomUUID();
    const user = (id, suffix) => ({
      _id: id,
      name: `ENV-PROBE-${tag}-${suffix}`,
      email: `probe.${tag}.${suffix}@example.com`,
      pendingTasks: [],
      dateCreated: new Date(),
    });
    await session.withTransaction(async () => {
      await users.insertOne(user(ids[0], 'commit'), { session });
    });
    assert.ok(await users.findOne({ _id: ids[0] }));
    const abort = new Error('Intentional environment-probe rollback');
    await assert.rejects(session.withTransaction(async () => {
      await users.insertOne(user(ids[1], 'abort'), { session });
      throw abort;
    }), (error) => error === abort);
    assert.equal(await users.findOne({ _id: ids[1] }), null);
    console.log(`${label}: ping, unique index, transaction commit and abort passed.`);
  } finally {
    if (session) await session.endSession();
    try {
      await connection.db.collection('users').deleteMany({ _id: { $in: ids } });
    } finally {
      await connection.close();
    }
  }
}

async function main() {
  const dev = databaseTarget(process.env.MONGODB_URI);
  const test = isolatedTestTarget();
  await probe(dev, 'Development database');
  await probe(test, 'Test database');
}

if (require.main === module) {
  main().catch(() => {
    console.error('Database probe failed. Check configured development/test URIs, Atlas access, indexes and transaction support. No credentials are printed.');
    process.exitCode = 1;
  });
}

module.exports = { probe };
