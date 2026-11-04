'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { isolatedTestTarget } = require('../../config/environment');
const { connectDatabase } = require('../../config/database');
const { probe } = require('../../scripts/probe-db');
const { createFixtures, cleanFixtures } = require('../../scripts/fixtures');
const createApp = require('../../app');
const User = require('../../models/user');
const Task = require('../../models/task');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

test('Atlas Round 1 integration: real MongoDB queries, indexes and transactions', { timeout: 90000 }, async (t) => {
  // Missing configuration fails this suite. It is deliberately not skipped.
  const target = isolatedTestTarget();
  await probe(target, 'Isolated test database').catch(() => {
    throw new Error('Atlas test-database prerequisite probe failed. Check private configuration, network access and transaction support.');
  });
  await connectDatabase(target.uri);
  const tag = randomUUID();
  const bulkUsers = Array.from({ length: 101 }, () => new mongoose.Types.ObjectId());
  const bulkTasks = Array.from({ length: 101 }, () => new mongoose.Types.ObjectId());
  const extraIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  let fixture;
  let server;
  try {
    fixture = await createFixtures(tag);
    await User.insertMany(bulkUsers.map((_id, i) => ({ _id, name: `BULK-${tag}-${String(i + 1).padStart(3, '0')}`,
      email: `bulk.${tag}.${i}@example.com` })));
    await Task.insertMany(bulkTasks.map((_id, i) => ({ _id, name: `BULK-${tag}-${String(i + 1).padStart(3, '0')}`,
      deadline: '2026-12-01T12:00:00Z' })));
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const ids = [fixture.task1, fixture.task2, fixture.task3];
    const where = { _id: { $in: ids } };
    async function get(resource, params = {}) {
      const url = new URL(`${base}/${resource}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      const response = await fetch(url);
      return { status: response.status, ...(await response.json()) };
    }

    await t.test('DATA/HTTP: both member types return persisted defaults and server dates', async () => {
      const user = await get(`users/${fixture.userA}`);
      assert.equal(user.status, 200);
      assert.deepEqual(user.data.pendingTasks, [fixture.task2]);
      assert.ok(Number.isFinite(Date.parse(user.data.dateCreated)));
      const task = await get(`tasks/${fixture.task1}`);
      assert.equal(task.status, 200);
      assert.equal(task.data.description, '');
      assert.equal(task.data.completed, false);
      assert.equal(task.data.assignedUser, '');
      assert.equal(task.data.assignedUserName, 'unassigned');
    });
    await t.test('QUERY: all six combined, with Mongo sort/projection/paging', async () => {
      const result = await get('tasks', { where, sort: { name: 1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 1, count: false });
      assert.equal(result.status, 200);
      assert.deepEqual(result.data, [{ name: fixture.names.task2 }]);
    });
    await t.test('QUERY: count ignores pagination and projections after validating them', async () => {
      const result = await get('tasks', { where, sort: { name: 1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 1, count: true });
      assert.equal(result.data, 3);
      assert.equal((await get('tasks', { where, count: true, select: 'NOT_JSON' })).status, 400);
    });
    await t.test('QUERY: Boolean, $in, date and logical filters execute in MongoDB', async () => {
      assert.equal((await get('tasks', { where: { ...where, completed: true }, count: true })).data, 1);
      const result = await get('tasks', { where: { ...where, $or: [{ completed: true }, { assignedUser: '' }] }, sort: { name: -1 } });
      assert.deepEqual(result.data.map((task) => task._id), [fixture.task3, fixture.task1]);
      assert.equal((await get('tasks', { where: { ...where, deadline: { $gte: '2026-12-01T12:00:00Z' } }, count: true })).data, 3);
    });
    await t.test('QUERY: tasks default 100, explicit zero unlimited, skip/limit exact page', async () => {
      const scope = { _id: { $in: bulkTasks.map(String) } };
      assert.equal((await get('tasks', { where: scope })).data.length, 100);
      assert.equal((await get('tasks', { where: scope, limit: 0 })).data.length, 101);
      const page = await get('tasks', { where: scope, sort: { name: 1 }, skip: 60, limit: 20 });
      assert.equal(page.data.length, 20);
      assert.equal(page.data[0].name, `BULK-${tag}-061`);
      assert.equal(page.data[19].name, `BULK-${tag}-080`);
      assert.equal((await get('tasks', { where: scope, count: true, limit: 1 })).data, 101);
    });
    await t.test('QUERY: users default unlimited; same composition as tasks', async () => {
      const scope = { _id: { $in: bulkUsers.map(String) } };
      assert.equal((await get('users', { where: scope })).data.length, 101);
      assert.deepEqual((await get('users', { where: scope, sort: { name: -1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 1 })).data,
        [{ name: `BULK-${tag}-100` }]);
      assert.equal((await get('users', { where: scope, count: true, skip: 60, limit: 1 })).data, 101);
    });
    await t.test('QUERY: member selection and irrelevant malformed parameters for both resources', async () => {
      for (const [resource, id, name] of [['users', fixture.userA, fixture.names.userA], ['tasks', fixture.task1, fixture.names.task1]]) {
        const result = await get(`${resource}/${id}`, { select: { name: 1, _id: 0 }, where: 'NOT_JSON', count: 'invalid', limit: '-1' });
        assert.equal(result.status, 200);
        assert.deepEqual(result.data, { name });
      }
    });
    await t.test('HTTP/VALID: collection miss is [], count miss 0, member miss 404', async () => {
      assert.deepEqual((await get('tasks', { where: { _id: { $in: [] } } })).data, []);
      assert.equal((await get('users', { where: { _id: { $in: [] } }, count: true })).data, 0);
      for (const resource of ['users', 'tasks']) {
        for (const id of ['bad-id', extraIds[0].toString()]) {
          assert.equal((await get(`${resource}/${id}`, { select: 'NOT_JSON' })).status, 404);
        }
      }
    });
    await t.test('VALID: invalid casts and query types return safe 400', async () => {
      for (const [key, value] of [['where', 'NOT_JSON'], ['where', { _id: 'bad-id' }],
        ['select', { name: 1, email: 0 }], ['skip', -1], ['count', null]]) {
        const result = await get('tasks', { [key]: value });
        assert.equal(result.status, 400);
        assert.deepEqual(result.data, {});
        assert.doesNotMatch(result.message, /CastError|MongoServerError|mongodb|password/);
      }
    });
    await t.test('DATA: real unique index rejects duplicate-email race', async () => {
      const email = `race.${tag}@example.com`;
      const outcomes = await Promise.allSettled(extraIds.map((_id) => User.create({ _id, name: 'Race fixture', email })));
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
      assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.code, 11000);
    });
    await t.test('DATA: creation date remains unchanged by model update', async () => {
      const before = await User.findById(fixture.userA);
      await User.updateOne({ _id: fixture.userA }, { $set: { dateCreated: new Date('2000-01-01') } });
      const after = await User.findById(fixture.userA);
      assert.equal(after.dateCreated.valueOf(), before.dateCreated.valueOf());
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
      await Task.deleteMany({ _id: { $in: bulkTasks } });
      await User.deleteMany({ _id: { $in: [...bulkUsers, ...extraIds] } });
      if (fixture) await cleanFixtures(fixture);
    } finally { await mongoose.disconnect(); }
  }
});
