'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const mongoose = require('mongoose');
const { isolatedTestTarget } = require('../../config/environment');
const { connectDatabase } = require('../../config/database');
const { createRelationshipService } = require('../../lib/relationships');
const createApp = require('../../app');
const User = require('../../models/user');
const Task = require('../../models/task');
const world = require('../helpers/world');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

test('Atlas Round 4 RACE: controlled stale snapshots and newly assigned tasks', { timeout: 120000 }, async (t) => {
  await connectDatabase(isolatedTestTarget().uri);
  async function race(w, first, second, verify) {
    const reached = Promise.withResolvers();
    const release = Promise.withResolvers();
    const touches = [];
    const mutations = createRelationshipService({ beforeWrite: async (event) => {
      touches.push(event);
      if (touches.length === 1) { reached.resolve(); await release.promise; }
    }, afterWrite: w.record });
    const server = createApp({ mutations }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const timer = setTimeout(() => { reached.reject(new Error('Race barrier timed out')); release.resolve(); }, 10000);
    const outcome = fetch(`http://127.0.0.1:${server.address().port}/api/${first.resource}`, {
      method: first.method, headers: { 'Content-Type': 'application/json' },
      body: first.body === undefined ? undefined : JSON.stringify(first.body), signal: AbortSignal.timeout(20000),
    }).then(async (response) => ({ status: response.status, ...(await response.json()) }))
      .then((value) => ({ value }), (error) => ({ error }));
    try {
      await reached.promise;
      assert.equal(touches[0].session.inTransaction(), true);
      await second(); // Commit the other request after all first-request reads.
      release.resolve();
      const result = await outcome;
      assert.equal(Boolean(result.error), false, 'First HTTP request must complete normally');
      assert.equal(touches.every((event) => event.session === touches[0].session), true);
      assert.equal(touches[0].session.hasEnded, true);
      await verify(result.value, touches);
      await w.invariants();
    } finally {
      release.resolve(); clearTimeout(timer); await outcome;
      await new Promise((resolve) => server.close(resolve));
    }
  }

  try {
    await t.test('RACE: same Task transfers re-read the owner after the other transfer commits', () => world(async (w) => {
      await race(w, { method: 'PUT', resource: `tasks/${w.task1}`, body: w.body({ assignedUser: w.userA }) }, async () => {
        assert.equal((await w.request('PUT', `tasks/${w.task1}`, w.body({ assignedUser: w.userB }))).status, 200);
      }, async (result) => {
        assert.equal(result.status, 200);
        assert.equal(result.data.assignedUser, w.userA);
        assert.deepEqual((await w.user(w.userB)).pendingTasks, []);
        assert.deepEqual(new Set((await w.user(w.userA)).pendingTasks), new Set([w.task1, w.task2]));
      });
    }));

    await t.test('RACE: two Task creations for one User merge both pending entries', () => world(async (w) => {
      let other;
      await race(w, { method: 'POST', resource: 'tasks', body: w.body({ name: `QA-${w.runTag}-first`, assignedUser: w.userA }) }, async () => {
        other = await w.request('POST', 'tasks', w.body({ name: `QA-${w.runTag}-second`, assignedUser: w.userA }));
        assert.equal(other.status, 201);
      }, async (result) => {
        assert.equal(result.status, 201);
        assert.deepEqual(new Set((await w.user(w.userA)).pendingTasks), new Set([w.task2, result.data._id, other.data._id]));
      });
    }));

    await t.test('RACE: completion re-reads a concurrently transferred Task and cleans both memberships', () => world(async (w) => {
      await race(w, { method: 'PUT', resource: `tasks/${w.task2}`, body: w.body({ completed: true, assignedUser: w.userA }) }, async () => {
        assert.equal((await w.request('PUT', `tasks/${w.task2}`, w.body({ assignedUser: w.userB }))).status, 200);
      }, async (result) => {
        assert.equal(result.status, 200);
        assert.equal(result.data.completed, true);
        assert.equal(result.data.assignedUser, w.userA);
        assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
        assert.deepEqual((await w.user(w.userB)).pendingTasks, []);
      });
    }));

    for (const action of ['rename', 'delete', 'clear pending']) {
      await t.test(`RACE: User ${action} re-queries a task committed after its initial task-list read`, () => world(async (w) => {
        const user = await w.user(w.userB);
        let assigned;
        const body = { name: action === 'rename' ? `QA-${w.runTag}-B-renamed` : user.name, email: user.email };
        await race(w, { method: action === 'delete' ? 'DELETE' : 'PUT', resource: `users/${w.userB}`, body: action === 'delete' ? undefined : body }, async () => {
          assigned = await w.request('POST', 'tasks', w.body({ assignedUser: w.userB, completed: action !== 'clear pending' }));
          assert.equal(assigned.status, 201);
        }, async (result) => {
          assert.equal(result.status, 200);
          const task = await w.task(assigned.data._id);
          if (action === 'rename') {
            assert.equal(task.assignedUser, w.userB);
            assert.equal(task.assignedUserName, body.name);
            assert.equal((await w.task(w.task3)).assignedUserName, body.name);
          } else {
            assert.equal(task.assignedUser, '');
            assert.equal(task.assignedUserName, 'unassigned');
            if (action === 'delete') assert.equal(await w.user(w.userB), null);
            else assert.deepEqual((await w.user(w.userB)).pendingTasks, []);
          }
        });
      }));
    }

    await t.test('RACE: Task deletion cleans a different owner committed after its initial read', () => world(async (w) => {
      await race(w, { method: 'DELETE', resource: `tasks/${w.task2}` }, async () => {
        const b = await w.user(w.userB);
        assert.equal((await w.request('PUT', `users/${w.userB}`, { name: b.name, email: b.email, pendingTasks: [w.task2] })).status, 200);
      }, async (result) => {
        assert.equal(result.status, 200);
        assert.equal(await w.task(w.task2), null);
        assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
        assert.deepEqual((await w.user(w.userB)).pendingTasks, []);
      });
    }));

    await t.test('RACE: User POST revalidates a task completed after reference reads and leaves no partial user', () => world(async (w) => {
      let afterCompletion;
      await race(w, { method: 'POST', resource: 'users', body: w.userBody({ pendingTasks: [w.task2] }) }, async () => {
        assert.equal((await w.request('PUT', `tasks/${w.task2}`, w.body({ assignedUser: w.userA, completed: true }))).status, 200);
        afterCompletion = await w.snapshot();
      }, async (result) => {
        assert.equal(result.status, 400);
        assert.deepEqual(result.data, {});
        assert.deepEqual(await w.snapshot(), afterCompletion);
        assert.equal(await User.countDocuments({ email: w.userBody().email }), 0);
      });
    }));

    await t.test('RACE: duplicate email is stopped after a stale uniqueness precheck', () => world(async (w) => {
      let afterCreate;
      await race(w, { method: 'POST', resource: 'users', body: w.userBody() }, async () => {
        assert.equal((await w.request('POST', 'users', w.userBody())).status, 201);
        afterCreate = await w.snapshot();
      }, async (result) => {
        assert.equal(result.status, 400);
        assert.equal(result.message, 'Email is already in use');
        assert.deepEqual(await w.snapshot(), afterCreate);
        assert.equal(await User.countDocuments({ email: w.userBody().email }), 1);
      });
    }));

    await t.test('DATA/guards: legacy documents without __v receive a real guarded first increment', () => world(async (w) => {
      await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.userA) }, { $unset: { __v: '' } });
      await Task.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.task2) }, { $unset: { __v: '' } });
      const result = await w.request('PUT', `tasks/${w.task2}`, w.body({ assignedUser: w.userA }));
      assert.equal(result.status, 200);
      assert.equal(result.data.__v, 1);
      assert.equal((await w.user(w.userA)).__v, 1);
    }));
  } finally { await mongoose.disconnect(); }
});
