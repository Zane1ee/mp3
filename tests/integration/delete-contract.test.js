'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { isolatedTestTarget } = require('../../config/environment');
const { connectDatabase } = require('../../config/database');
const world = require('../helpers/world');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

test('Atlas DELETE grader regression: actual 204 bytes plus committed linked state', { timeout: 60000 }, async (t) => {
  await connectDatabase(isolatedTestTarget().uri);
  try {
    await t.test('Task DELETE has zero body bytes; fresh GETs see deletion and pending cleanup immediately', () => world(async (w) => {
      const untouchedUser = await w.user(w.userB);
      const untouchedTask = await w.task(w.task3);
      const response = await fetch(`${w.base}/tasks/${w.task2}`, { method: 'DELETE', signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, 204);
      assert.equal((await response.arrayBuffer()).byteLength, 0, 'Observe actual HTTP bytes, not a synthesized parsed result.');
      assert.equal((await w.request('GET', `tasks/${w.task2}`)).status, 404);
      assert.deepEqual((await w.request('GET', `users/${w.userA}`)).data.pendingTasks, []);
      assert.deepEqual(await w.user(w.userB), untouchedUser);
      assert.deepEqual(await w.task(w.task3), untouchedTask);
      await w.rejected('DELETE', `tasks/${w.task2}`, undefined, 404);
      await w.rejected('DELETE', 'tasks/not-an-id', undefined, 404);
      await w.invariants();
    }));

    await t.test('User DELETE has zero body bytes; pending and completed tasks persist unassigned', () => world(async (w) => {
      await w.request('PUT', `tasks/${w.task2}`, w.body({ assignedUser: w.userB }));
      const pending = (await w.request('GET', `tasks/${w.task2}`)).data;
      const completed = (await w.request('GET', `tasks/${w.task3}`)).data;
      const untouchedUser = await w.user(w.userA);
      const untouchedTask = await w.task(w.task1);
      const response = await fetch(`${w.base}/users/${w.userB}`, { method: 'DELETE', signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, 204);
      assert.equal((await response.arrayBuffer()).byteLength, 0);
      assert.equal((await w.request('GET', `users/${w.userB}`)).status, 404);
      for (const before of [pending, completed]) {
        const current = (await w.request('GET', `tasks/${before._id}`)).data;
        assert.equal(current.assignedUser, '');
        assert.equal(current.assignedUserName, 'unassigned');
        assert.equal(current.completed, before.completed);
        assert.equal(current.dateCreated, before.dateCreated);
        assert.equal(current._id, before._id);
      }
      assert.deepEqual(await w.user(w.userA), untouchedUser);
      assert.deepEqual(await w.task(w.task1), untouchedTask);
      await w.rejected('DELETE', `users/${w.userB}`, undefined, 404);
      await w.rejected('DELETE', 'users/not-an-id', undefined, 404);
      await w.invariants();
    }));
  } finally { await mongoose.disconnect(); }
});
