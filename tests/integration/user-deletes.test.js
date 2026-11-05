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

test('Atlas Round 3: User POST/PUT and both DELETE endpoints', { timeout: 180000 }, async (t) => {
  await connectDatabase(isolatedTestTarget().uri);

  async function injectedFailure(w, method, resource, body, fail) {
    const before = await w.snapshot();
    let observed = false;
    const mutations = createRelationshipService({ afterWrite: async (event) => {
      w.record(event);
      if (fail(event)) {
        observed = true;
        assert.equal(event.session.inTransaction(), true);
        const document = await (event.model === 'User' ? User : Task).findById(event.id).session(event.session).lean();
        if (method === 'DELETE' && ((resource.startsWith('users/') && event.model === 'User') ||
          (resource.startsWith('tasks/') && event.model === 'Task'))) assert.equal(document, null, 'Actual resource deletion happened before rollback');
        else assert.ok(document, 'Actual insert/update happened before rollback');
        throw new Error('private password mongodb+srv://secret injected after real write');
      }
    } });
    const server = createApp({ mutations }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${resource}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { message: 'An unexpected server error occurred', data: {} });
      assert.equal(observed, true);
      assert.deepEqual(await w.snapshot(), before, 'Every document/version survives a failed request unchanged');
    } finally { await new Promise((resolve) => server.close(resolve)); }
  }

  try {
    await t.test('USER POST: trim, preserve email case, defaults and server-owned identity/date/version', () => world(async (w) => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const result = await w.request('POST', 'users', w.userBody({ name: '  New User  ', email: `  Mixed.${w.runTag}@Example.com  `,
        _id: fakeId, dateCreated: '2000-01-01', __v: 999, $set: { pendingTasks: [w.task1] }, arbitrary: true }));
      assert.equal(result.status, 201);
      assert.equal(result.data.name, 'New User');
      assert.equal(result.data.email, `Mixed.${w.runTag}@Example.com`);
      assert.deepEqual(result.data.pendingTasks, []);
      assert.notEqual(result.data._id, fakeId);
      assert.equal(result.data.__v, 0);
      assert.ok(Date.parse(result.data.dateCreated) > Date.parse('2026-01-01'));
      assert.equal(result.data.$set, undefined);
      assert.equal(result.data.arbitrary, undefined);
      assert.deepEqual((await w.request('GET', `users/${result.data._id}`)).data, result.data);
    }));

    await t.test('USER POST: pending tasks move from old owner; duplicate and uppercase IDs normalize once', () => world(async (w) => {
      const result = await w.request('POST', 'users', w.userBody({ pendingTasks: [w.task1, w.task2, w.task1.toUpperCase()] }));
      assert.equal(result.status, 201);
      assert.deepEqual(result.data.pendingTasks, [w.task1, w.task2]);
      assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
      for (const id of [w.task1, w.task2]) {
        const task = await w.task(id);
        assert.equal(task.assignedUser, result.data._id);
        assert.equal(task.assignedUserName, result.data.name);
      }
    }));

    await t.test('USER PUT: own email is valid; rename cascades to pending/completed tasks and preserves dates', () => world(async (w) => {
      await w.request('PUT', `tasks/${w.task3}`, w.body({ assignedUser: w.userA, completed: true }));
      const original = await w.user(w.userA);
      const dates = [await w.task(w.task2), await w.task(w.task3)].map((task) => task.dateCreated.valueOf());
      const result = await w.request('PUT', `users/${w.userA.toUpperCase()}`, { name: `QA-${w.runTag}-A-renamed`, email: original.email,
        pendingTasks: [w.task2], _id: w.userB, dateCreated: '2000-01-01', __v: 999 });
      assert.equal(result.status, 200);
      assert.equal(result.data._id, w.userA);
      assert.equal(result.data.dateCreated, original.dateCreated.toISOString());
      assert.equal(result.data.__v, original.__v + 1);
      for (const [i, id] of [w.task2, w.task3].entries()) {
        const task = await w.task(id);
        assert.equal(task.assignedUserName, result.data.name);
        assert.equal(task.dateCreated.valueOf(), dates[i]);
      }
      assert.deepEqual(result.data.pendingTasks, [w.task2]);
      assert.deepEqual((await w.request('GET', `users/${w.userA}`)).data, result.data);
    }));

    await t.test('USER PUT: moving, removing and omitting a nonempty pending list preserves completed ownership', () => world(async (w) => {
      const b = await w.user(w.userB);
      const moved = await w.request('PUT', `users/${w.userB}`, { name: b.name, email: b.email, pendingTasks: [w.task1, w.task2] });
      assert.equal(moved.status, 200);
      assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
      const removed = await w.request('PUT', `users/${w.userB}`, { name: b.name, email: b.email, pendingTasks: [w.task2] });
      assert.equal(removed.status, 200);
      assert.equal((await w.task(w.task1)).assignedUser, '');
      const cleared = await w.request('PUT', `users/${w.userB}`, { name: `QA-${w.runTag}-B-renamed`, email: b.email });
      assert.equal(cleared.status, 200);
      assert.deepEqual(cleared.data.pendingTasks, []);
      assert.equal((await w.task(w.task2)).assignedUser, '');
      assert.equal((await w.task(w.task3)).assignedUser, w.userB);
      assert.equal((await w.task(w.task3)).assignedUserName, cleared.data.name);
    }));

    await t.test('USER transport: form JSON-array and parser-produced arrays share strict validation', () => world(async (w) => {
      const created = await w.request('POST', 'users', w.userBody({ pendingTasks: JSON.stringify([w.task1, w.task2]) }), { form: true });
      assert.equal(created.status, 201);
      assert.deepEqual(created.data.pendingTasks, [w.task1, w.task2]);
      const replaced = await w.request('PUT', `users/${created.data._id}`, w.userBody({ 'pendingTasks[0]': w.task1 }), { form: true });
      assert.equal(replaced.status, 200);
      assert.deepEqual(replaced.data.pendingTasks, [w.task1]);
      assert.equal((await w.task(w.task2)).assignedUser, '');
      await w.rejected('PUT', `users/${created.data._id}`, w.userBody({ pendingTasks: 'not-json' }), 400, { form: true });
      await w.rejected('POST', 'users', w.userBody({ pendingTasks: '[]' }), 400);
    }));

    await t.test('VALID/ATOM: User POST/PUT invalid raw fields preserve full snapshots', () => world(async (w) => {
      const invalid = [ {}, { name: 'No email' }, { email: 'valid@example.com' }, w.userBody({ name: 1 }),
        w.userBody({ name: ' ' }), w.userBody({ email: null }), w.userBody({ email: 'invalid' }),
        w.userBody({ pendingTasks: null }), w.userBody({ pendingTasks: w.task1 }),
        w.userBody({ pendingTasks: ['bad-id'] }), w.userBody({ pendingTasks: [42] }), [], null,
      ];
      for (const body of invalid) {
        await w.rejected('POST', 'users', body, 400);
        await w.rejected('PUT', `users/${w.userA}`, body, 400);
      }
    }));

    await t.test('VALID: URL, fields, duplicate email, missing reference and completion have exact priority', () => world(async (w) => {
      const a = await w.user(w.userA);
      const b = await w.user(w.userB);
      const missing = new mongoose.Types.ObjectId().toString();
      for (const id of ['bad-id', missing]) await w.rejected('PUT', `users/${id}`, {}, 404);
      for (const [method, resource] of [['POST', 'users'], ['PUT', `users/${w.userA}`]]) {
        const malformed = await w.rejected(method, resource, w.userBody({ email: b.email, pendingTasks: ['bad-id'] }), 400);
        assert.match(malformed.message, /valid IDs/);
        const duplicate = await w.rejected(method, resource, w.userBody({ email: b.email, pendingTasks: [w.task3, missing] }), 400);
        assert.equal(duplicate.message, 'Email is already in use');
        await w.rejected(method, resource, w.userBody({ pendingTasks: [w.task3, missing] }), 404);
        await w.rejected(method, resource, w.userBody({ pendingTasks: [w.task3] }), 400);
      }
      await w.rejected('POST', 'users', w.userBody({ email: a.email, pendingTasks: [w.task1] }), 400);
      const response = await fetch(`${w.base}/users/bad-id`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"name":' });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: 'Invalid request body', data: {} });
    }));

    await t.test('RACE/HTTP: duplicate User POST yields one 201, one safe 400 and one committed assignment', () => world(async (w) => {
      const body = w.userBody({ pendingTasks: [w.task1] });
      const results = await Promise.all([w.request('POST', 'users', body, { check: false }), w.request('POST', 'users', body, { check: false })]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 400]);
      const winner = results.find((result) => result.status === 201);
      assert.equal((await w.task(w.task1)).assignedUser, winner.data._id);
      assert.deepEqual(results.find((result) => result.status === 400).data, {});
      assert.equal(await User.countDocuments({ email: body.email }), 1);
      await w.invariants();
    }));

    await t.test('RACE/HTTP: two User PUTs cannot commit the same email; loser retains its original document', () => world(async (w) => {
      const before = new Map([[w.userA, JSON.parse(JSON.stringify(await w.user(w.userA)))], [w.userB, JSON.parse(JSON.stringify(await w.user(w.userB)))]]);
      const email = `qa.${w.runTag}.race@example.com`;
      const results = await Promise.all([w.request('PUT', `users/${w.userA}`, { name: `QA-${w.runTag}-A-new`, email }, { check: false }),
        w.request('PUT', `users/${w.userB}`, { name: `QA-${w.runTag}-B-new`, email }, { check: false })]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
      const loserId = results[0].status === 400 ? w.userA : w.userB;
      assert.deepEqual(JSON.parse(JSON.stringify(await w.user(loserId))), before.get(loserId));
      assert.equal(await User.countDocuments({ email }), 1);
      await w.invariants();
    }));

    await t.test('TASK DELETE: pending, completed and unassigned states use empty 204 and safe repeat JSON 404', () => world(async (w) => {
      for (const id of [w.task2, w.task3, w.task1]) {
        const result = await w.request('DELETE', `tasks/${id}`);
        assert.deepEqual(result, { status: 204 });
        assert.equal((await w.request('GET', `tasks/${id}`)).status, 404);
        await w.rejected('DELETE', `tasks/${id}`, undefined, 404);
        assert.deepEqual((await w.request('GET', `tasks?where=${encodeURIComponent(JSON.stringify({ _id: id }))}`)).data, []);
      }
      assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
      assert.deepEqual((await w.user(w.userB)).pendingTasks, []);
    }));

    await t.test('USER DELETE: pending and completed tasks survive unassigned with dates and completion preserved', () => world(async (w) => {
      await w.request('PUT', `tasks/${w.task3}`, w.body({ assignedUser: w.userA, completed: true }));
      const tasks = [await w.task(w.task2), await w.task(w.task3)];
      const otherUser = JSON.parse(JSON.stringify(await w.user(w.userB)));
      const result = await w.request('DELETE', `users/${w.userA.toUpperCase()}`);
      assert.deepEqual(result, { status: 204 });
      assert.equal((await w.request('GET', `users/${w.userA}`)).status, 404);
      await w.rejected('DELETE', `users/${w.userA}`, undefined, 404);
      for (const original of tasks) {
        const current = await w.task(original._id);
        assert.ok(current);
        assert.equal(current.assignedUser, '');
        assert.equal(current.assignedUserName, 'unassigned');
        assert.equal(current.completed, original.completed);
        assert.equal(current.dateCreated.valueOf(), original.dateCreated.valueOf());
      }
      assert.deepEqual(JSON.parse(JSON.stringify(await w.user(w.userB))), otherUser);
    }));

    await t.test('USER DELETE: completed-only and empty users do not delete surviving tasks', () => world(async (w) => {
      const before = await w.task(w.task3);
      const result = await w.request('DELETE', `users/${w.userB}`);
      assert.equal(result.status, 204);
      assert.equal((await w.task(w.task3)).assignedUser, '');
      assert.equal((await w.task(w.task3)).dateCreated.valueOf(), before.dateCreated.valueOf());
      const created = await w.request('POST', 'users', w.userBody());
      const snapshot = await w.snapshot();
      assert.equal((await w.request('DELETE', `users/${created.data._id}`)).status, 204);
      assert.deepEqual((await w.snapshot()).tasks, snapshot.tasks);
    }));

    await t.test('DELETE: missing/malformed IDs for both resources preserve every document', () => world(async (w) => {
      for (const resource of ['users', 'tasks']) {
        for (const id of ['bad-id', new mongoose.Types.ObjectId().toString()]) await w.rejected('DELETE', `${resource}/${id}`, undefined, 404);
      }
    }));

    await t.test('ATOM/USER PUT: rollback after old-owner update and after an actual renamed task write', () => world(async (w) => {
      const b = await w.user(w.userB);
      await injectedFailure(w, 'PUT', `users/${w.userB}`, { name: b.name, email: b.email, pendingTasks: [w.task2] }, (event) => event.model === 'User');
      await w.request('PUT', `tasks/${w.task3}`, w.body({ assignedUser: w.userA, completed: true }));
      const a = await w.user(w.userA);
      await injectedFailure(w, 'PUT', `users/${w.userA}`, { name: `QA-${w.runTag}-A-renamed`, email: a.email, pendingTasks: [w.task2] }, (event) => event.model === 'Task');
    }));

    await t.test('ATOM/USER POST: new user insertion and transferred task update both roll back', () => world(async (w) => {
      for (const model of ['User', 'Task']) {
        await injectedFailure(w, 'POST', 'users', w.userBody({ pendingTasks: [w.task2] }),
          (event) => event.model === model && (model === 'Task' || ![w.userA, w.userB].includes(event.id)));
      }
    }));

    await t.test('ATOM/TASK DELETE: rollback after pending cleanup and after actual task deletion', () => world(async (w) => {
      for (const model of ['User', 'Task']) await injectedFailure(w, 'DELETE', `tasks/${w.task2}`, undefined, (event) => event.model === model);
      assert.equal((await w.request('GET', `tasks/${w.task2}`)).status, 200);
    }));

    await t.test('ATOM/USER DELETE: rollback after first unassignment and after actual user deletion', () => world(async (w) => {
      await w.request('PUT', `tasks/${w.task3}`, w.body({ assignedUser: w.userA, completed: true }));
      for (const model of ['Task', 'User']) await injectedFailure(w, 'DELETE', `users/${w.userA}`, undefined, (event) => event.model === model);
      assert.equal((await w.request('GET', `users/${w.userA}`)).status, 200);
    }));

    await t.test('SESSION: User replacement and deletion carry one session and persisted version guards', () => world(async (w) => {
      const original = await w.user(w.userA);
      for (const operation of [() => w.service.replaceUser(w.userA, { name: original.name, email: original.email, pendingTasks: [w.task1, w.task2] }),
        () => w.service.deleteUser(w.userA)]) {
        const commands = [];
        mongoose.set('debug', (collection, method, ...args) => commands.push({ collection, method, args }));
        try { await operation(); }
        finally { mongoose.set('debug', false); }
        assert.ok(commands.length >= 3);
        const session = commands[0].args.at(-1).session;
        assert.ok(session);
        for (const command of commands) {
          assert.equal(command.args.at(-1).session, session);
          if (['findOneAndUpdate', 'deleteOne'].includes(command.method)) assert.ok(Object.hasOwn(command.args[0], '__v'));
        }
        await w.invariants();
      }
    }));

    for (const action of ['rename', 'delete']) {
      await t.test(`RACE/HTTP deterministic: completed Task POST vs User ${action} uses committed current state`, () => world(async (w) => {
        const arrived = Promise.withResolvers();
        const release = Promise.withResolvers();
        let attempts = 0;
        const service = createRelationshipService({ beforeWrite: async ({ model }) => {
          if (model === 'User' && ++attempts === 1) { arrived.resolve(); await release.promise; }
        }, afterWrite: w.record });
        const server = createApp({ mutations: service }).listen(0, '127.0.0.1');
        await once(server, 'listening');
        const timer = setTimeout(() => { arrived.reject(new Error('Race barrier timed out')); release.resolve(); }, 10000);
        const pending = fetch(`http://127.0.0.1:${server.address().port}/api/tasks`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w.body({ assignedUser: w.userB, completed: true })) });
        try {
          await arrived.promise;
          if (action === 'rename') {
            const b = await w.user(w.userB);
            assert.equal((await w.request('PUT', `users/${w.userB}`, { name: `QA-${w.runTag}-B-new`, email: b.email })).status, 200);
          } else assert.equal((await w.request('DELETE', `users/${w.userB}`)).status, 204);
          release.resolve();
          const response = await pending;
          const body = await response.json();
          if (action === 'rename') {
            assert.equal(response.status, 201);
            assert.ok(attempts >= 2);
            assert.equal(body.data.assignedUserName, `QA-${w.runTag}-B-new`);
            assert.equal(await Task.countDocuments({ name: w.body().name }), 1);
          } else {
            assert.equal(response.status, 404);
            assert.deepEqual(body.data, {});
            assert.equal(await Task.countDocuments({ name: w.body().name }), 0);
          }
          await w.invariants();
        } finally {
          release.resolve(); clearTimeout(timer); await pending;
          await new Promise((resolve) => server.close(resolve));
        }
      }));
    }

    await t.test('RACE/HTTP: User task transfer vs Task DELETE ends without dangling pending IDs', () => world(async (w) => {
      const a = await w.user(w.userA);
      const results = await Promise.all([w.request('PUT', `users/${w.userA}`, { name: a.name, email: a.email, pendingTasks: [w.task1, w.task2] }, { check: false }),
        w.request('DELETE', `tasks/${w.task1}`, undefined, { check: false })]);
      assert.ok([200, 404].includes(results[0].status));
      assert.equal(results[1].status, 204);
      assert.equal(await w.task(w.task1), null);
      assert.equal((await w.user(w.userA)).pendingTasks.includes(w.task1), false);
      await w.invariants();
    }));
  } finally { await mongoose.disconnect(); }
});
