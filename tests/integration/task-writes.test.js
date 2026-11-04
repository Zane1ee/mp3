'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const mongoose = require('mongoose');
const { isolatedTestTarget } = require('../../config/environment');
const { connectDatabase } = require('../../config/database');
const { cleanFixtures } = require('../../scripts/fixtures');
const world = require('../helpers/world');
const { createRelationshipService } = require('../../lib/relationships');
const createApp = require('../../app');
const User = require('../../models/user');
const Task = require('../../models/task');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

test('Atlas Round 2: atomic relationship service and Task POST/PUT', { timeout: 180000 }, async (t) => {
  await connectDatabase(isolatedTestTarget().uri);



  try {
    await t.test('TASK POST: defaults, required envelope and ignored server-owned/operator inputs', () => world(async (w) => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const created = await w.request('POST', 'tasks', w.body({ _id: fakeId, dateCreated: '2000-01-01', __v: 999,
        pendingTasks: [w.task1], $set: { assignedUser: w.userA } }));
      assert.equal(created.status, 201);
      assert.notEqual(created.data._id, fakeId);
      assert.equal(created.data.description, '');
      assert.equal(created.data.completed, false);
      assert.equal(created.data.assignedUser, '');
      assert.equal(created.data.assignedUserName, 'unassigned');
      assert.equal(created.data.__v, 0);
      assert.ok(Date.parse(created.data.dateCreated) > Date.parse('2026-01-01'));
      assert.deepEqual((await w.request('GET', `tasks/${created.data._id}`)).data, created.data);
      assert.equal(created.data.$set, undefined);
    }));

    await t.test('TASK POST: canonical assigned ID and derived name add pending membership once', () => world(async (w) => {
      const created = await w.request('POST', 'tasks', w.body({ assignedUser: w.userA.toUpperCase() }));
      assert.equal(created.status, 201);
      assert.equal(created.data.assignedUser, w.userA);
      assert.equal(created.data.assignedUserName, w.names.userA);
      assert.deepEqual((await w.user(w.userA)).pendingTasks, [w.task2, created.data._id]);
    }));

    await t.test('TASK POST: completed assignment retains ownership, excludes pending and increments user version', () => world(async (w) => {
      const before = await w.user(w.userB);
      const created = await w.request('POST', 'tasks', w.body({ assignedUser: w.userB, completed: true }));
      assert.equal(created.status, 201);
      assert.equal(created.data.assignedUser, w.userB);
      const after = await w.user(w.userB);
      assert.deepEqual(after.pendingTasks, []);
      assert.equal(after.__v, before.__v + 1);
    }));

    await t.test('TASK PUT: transfer updates both users, returns current task and preserves identity/date', () => world(async (w) => {
      const original = await w.task(w.task2);
      const result = await w.request('PUT', `tasks/${w.task2}`, w.body({ name: `QA-${w.runTag}-renamed`, description: 'replacement',
        assignedUser: w.userB, assignedUserName: w.names.userB, deadline: '2026-12-01T07:00:00-05:00',
        _id: w.task1, dateCreated: '2000-01-01', __v: 999 }));
      assert.equal(result.status, 200);
      assert.equal(result.data._id, w.task2);
      assert.equal(result.data.dateCreated, original.dateCreated.toISOString());
      assert.equal(result.data.deadline, '2026-12-01T12:00:00.000Z');
      assert.equal(result.data.description, 'replacement');
      assert.equal(result.data.__v, original.__v + 1);
      assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
      assert.deepEqual((await w.user(w.userB)).pendingTasks, [w.task2]);
      assert.deepEqual((await w.request('GET', `tasks/${w.task2}`)).data, result.data);
    }));

    await t.test('TASK PUT: complete, repeated completion, reopen and explicit unassignment', () => world(async (w) => {
      for (const completed of [true, true, false, false]) {
        const result = await w.request('PUT', `tasks/${w.task2}`, w.body({ assignedUser: w.userA, completed }));
        assert.equal(result.status, 200);
        assert.equal(result.data.assignedUser, w.userA);
        assert.deepEqual((await w.user(w.userA)).pendingTasks, completed ? [] : [w.task2]);
      }
      const result = await w.request('PUT', `tasks/${w.task2}`, w.body({ assignedUser: '', assignedUserName: 'ignored name' }));
      assert.equal(result.status, 200);
      assert.equal(result.data.assignedUserName, 'unassigned');
      assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
    }));

    await t.test('TASK PUT: completed transfer is valid; reopening adds the new owner only', () => world(async (w) => {
      const moved = await w.request('PUT', `tasks/${w.task3}`, w.body({ assignedUser: w.userA, completed: true }));
      assert.equal(moved.status, 200);
      assert.deepEqual((await w.user(w.userB)).pendingTasks, []);
      assert.deepEqual((await w.user(w.userA)).pendingTasks, [w.task2]);
      await w.request('PUT', `tasks/${w.task3}`, w.body({ assignedUser: w.userA, completed: false }));
      assert.deepEqual((await w.user(w.userA)).pendingTasks, [w.task2, w.task3]);
    }));

    await t.test('TASK PUT: omitted optional fields reset populated values, never act as PATCH/upsert', () => world(async (w) => {
      await w.request('PUT', `tasks/${w.task2}`, w.body({ description: 'nonempty', completed: true, assignedUser: w.userB }));
      const result = await w.request('PUT', `tasks/${w.task2}`, w.body());
      assert.equal(result.status, 200);
      for (const [key, value] of Object.entries({ description: '', completed: false, assignedUser: '', assignedUserName: 'unassigned' })) assert.equal(result.data[key], value);
      await w.rejected('PUT', `tasks/${w.task2}`, { description: 'PATCH-like body' }, 400);
      await w.rejected('PUT', `tasks/${new mongoose.Types.ObjectId()}`, w.body(), 404);
    }));

    await t.test('TASK transport: explicit form false/true works; JSON Boolean strings and invalid form values fail', () => world(async (w) => {
      const created = await w.request('POST', 'tasks', w.body({ assignedUser: w.userA, completed: 'false' }), { form: true });
      assert.equal(created.status, 201);
      assert.equal(created.data.completed, false);
      const replaced = await w.request('PUT', `tasks/${created.data._id}`, w.body({ assignedUser: w.userA, completed: 'true' }), { form: true });
      assert.equal(replaced.status, 200);
      assert.equal(replaced.data.completed, true);
      await w.rejected('POST', 'tasks', w.body({ completed: 'false' }), 400);
      await w.rejected('POST', 'tasks', w.body({ completed: '0' }), 400, { form: true });
    }));

    await t.test('VALID: URL 404 before fields; fields 400 before reference 404; missing reference before name 400', () => world(async (w) => {
      const missing = new mongoose.Types.ObjectId().toString();
      for (const id of ['not-an-id', missing]) await w.rejected('PUT', `tasks/${id}`, {}, 404);
      await w.rejected('PUT', `tasks/${w.task2}`, { assignedUser: missing }, 400);
      for (const [method, resource] of [['POST', 'tasks'], ['PUT', `tasks/${w.task2}`]]) {
        await w.rejected(method, resource, w.body({ assignedUser: 'bad-id' }), 400);
        await w.rejected(method, resource, w.body({ assignedUser: missing, assignedUserName: 'wrong' }), 404);
        await w.rejected(method, resource, w.body({ assignedUser: w.userB, assignedUserName: 'wrong' }), 400);
      }
    }));

    await t.test('VALID/ATOM: POST and PUT invalid inputs preserve full snapshots including versions', () => world(async (w) => {
      const invalid = [ {}, { name: 'missing deadline' }, w.body({ name: 1 }), w.body({ name: ' ' }),
        w.body({ deadline: '2026-02-30' }), w.body({ deadline: 0 }), w.body({ completed: null }),
        w.body({ description: null }), w.body({ assignedUser: null }), w.body({ assignedUserName: 42 }),
        [], null,
      ];
      for (const body of invalid) {
        await w.rejected('POST', 'tasks', body, 400);
        await w.rejected('PUT', `tasks/${w.task2}`, body, 400);
      }
      const before = await w.snapshot();
      const response = await fetch(`${w.base}/tasks/not-an-id`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"name":' });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: 'Invalid request body', data: {} });
      assert.deepEqual(await w.snapshot(), before);
    }));

    await t.test('ATOM: actual first-user write and task insertion both roll back on injected failure', () => world(async (w) => {
      for (const failModel of ['User', 'Task']) {
        const before = await w.snapshot();
        let observed = false;
        const faulty = createRelationshipService({ afterWrite: async (event) => {
          w.record(event);
          if (event.model === failModel) {
            observed = true;
            const document = await (failModel === 'User' ? User : Task).findById(event.id).session(event.session).lean();
            assert.ok(document, 'Hook runs after a real database write');
            if (failModel === 'User') assert.ok(document.__v > 0);
            throw new Error('private password mongodb+srv://secret after actual write');
          }
        } });
        const faultServer = createApp({ mutations: faulty }).listen(0, '127.0.0.1');
        await once(faultServer, 'listening');
        try {
          const response = await fetch(`http://127.0.0.1:${faultServer.address().port}/api/tasks`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w.body({ assignedUser: w.userB })) });
          assert.equal(response.status, 500);
          assert.deepEqual(await response.json(), { message: 'An unexpected server error occurred', data: {} });
          assert.equal(observed, true);
          assert.deepEqual(await w.snapshot(), before);
        } finally { await new Promise((resolve) => faultServer.close(resolve)); }
      }
    }));

    await t.test('SERVICE: rename includes completed tasks; omitted pending clears only incomplete ownership', () => world(async (w) => {
      await w.service.replaceTask(w.task3, w.body({ completed: true, assignedUser: w.userA }));
      await w.invariants();
      const before = await w.user(w.userA);
      const renamed = await w.service.replaceUser(w.userA, { name: `QA-${w.runTag}-A-renamed`, email: before.email, pendingTasks: [w.task2] });
      await w.invariants();
      assert.equal(renamed.dateCreated.valueOf(), before.dateCreated.valueOf());
      assert.equal((await w.task(w.task2)).assignedUserName, renamed.name);
      assert.equal((await w.task(w.task3)).assignedUserName, renamed.name);
      await w.service.replaceUser(w.userA, { name: renamed.name, email: renamed.email });
      await w.invariants();
      assert.equal((await w.task(w.task2)).assignedUser, '');
      assert.equal((await w.task(w.task3)).assignedUser, w.userA);
    }));

    await t.test('SERVICE: user create/replace moves tasks and checks all missing refs before completion', () => world(async (w) => {
      const created = await w.service.createUser({ name: `QA-${w.runTag}-C`, email: `qa.${w.runTag}.c@example.com`,
        pendingTasks: [w.task1, w.task2, w.task1.toUpperCase()] });
      const id = String(created._id);
      await w.invariants();
      assert.deepEqual(created.pendingTasks, [w.task1, w.task2]);
      assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
      await w.service.replaceUser(id, { name: created.name, email: created.email, pendingTasks: [w.task1] });
      await w.invariants();
      assert.equal((await w.task(w.task2)).assignedUser, '');
      const before = await w.snapshot();
      await assert.rejects(w.service.replaceUser(id, { name: created.name, email: created.email,
        pendingTasks: [w.task3, new mongoose.Types.ObjectId().toString()] }), { status: 404 });
      await assert.rejects(w.service.replaceUser(id, { name: created.name, email: created.email, pendingTasks: [w.task3] }), { status: 400 });
      assert.deepEqual(await w.snapshot(), before);
    }));

    await t.test('SERVICE: task deletion removes membership; user deletion retains and unassigns all task states', () => world(async (w) => {
      await w.service.deleteTask(w.task2);
      await w.invariants();
      assert.deepEqual((await w.user(w.userA)).pendingTasks, []);
      await w.service.replaceTask(w.task1, w.body({ assignedUser: w.userB }));
      await w.invariants();
      await w.service.deleteUser(w.userB);
      await w.invariants();
      assert.equal(await w.user(w.userB), null);
      for (const id of [w.task1, w.task3]) {
        assert.ok(await w.task(id));
        assert.equal((await w.task(id)).assignedUser, '');
        assert.equal((await w.task(id)).assignedUserName, 'unassigned');
      }
    }));

    await t.test('SERVICE/session: every database operation carries the same active session and guarded writes', () => world(async (w) => {
      const commands = [];
      mongoose.set('debug', (collection, method, ...args) => commands.push({ collection, method, args }));
      try { await w.service.createTask(w.body({ assignedUser: w.userB, completed: true })); }
      finally { mongoose.set('debug', false); }
      assert.ok(commands.length >= 3);
      const sessions = commands.map(({ args }) => args.at(-1).session);
      assert.ok(sessions[0]);
      assert.ok(sessions.every((session) => session === sessions[0]));
      const userWrite = commands.find((command) => command.collection === 'users' && command.method === 'findOneAndUpdate');
      assert.ok(Object.hasOwn(userWrite.args[0], '__v'));
      assert.deepEqual(userWrite.args[1].$inc, { __v: 1 });
    }));

    await t.test('RACE: two tasks assigned to the same user do not lose pending entries', () => world(async (w) => {
      const tasks = await Promise.all([w.service.createTask(w.body({ name: `QA-${w.runTag}-race1`, assignedUser: w.userA })),
        w.service.createTask(w.body({ name: `QA-${w.runTag}-race2`, assignedUser: w.userA }))]);
      await w.invariants();
      assert.deepEqual(new Set((await w.user(w.userA)).pendingTasks), new Set([w.task2, ...tasks.map((task) => String(task._id))]));
    }));

    await t.test('RACE: same-task transfers and completion/transfer leave one consistent final owner', () => world(async (w) => {
      await Promise.all([w.service.replaceTask(w.task1, w.body({ assignedUser: w.userA })),
        w.service.replaceTask(w.task1, w.body({ assignedUser: w.userB }))]);
      await w.invariants();
      await Promise.all([w.service.replaceTask(w.task1, w.body({ completed: true, assignedUser: w.userA })),
        w.service.replaceTask(w.task1, w.body({ completed: false, assignedUser: w.userB }))]);
      await w.invariants();
    }));

    for (const action of ['rename', 'delete']) {
      await t.test(`RACE deterministic: completed assignment recomputes after concurrent user ${action}`, () => world(async (w) => {
        const arrived = Promise.withResolvers();
        const release = Promise.withResolvers();
        let attempts = 0;
        const paused = createRelationshipService({ beforeWrite: async ({ model }) => {
          if (model === 'User') {
            attempts++;
            if (attempts === 1) { arrived.resolve(); await release.promise; }
          }
        }, afterWrite: w.record });
        const original = JSON.parse(JSON.stringify(await w.task(w.task1)));
        const pending = paused.replaceTask(w.task1, w.body({ assignedUser: w.userB, completed: true }));
        const outcome = pending.then((value) => ({ value }), (error) => ({ error }));
        const timer = setTimeout(() => { arrived.reject(new Error('Race barrier timed out')); release.resolve(); }, 10000);
        try {
          await arrived.promise;
          if (action === 'rename') {
            const user = await w.user(w.userB);
            await w.service.replaceUser(w.userB, { name: `QA-${w.runTag}-B-renamed`, email: user.email });
          } else await w.service.deleteUser(w.userB);
          release.resolve();
          const result = await outcome;
          if (action === 'rename') {
            assert.equal(result.error, undefined);
            assert.ok(attempts >= 2, 'Driver retried a stale snapshot');
            assert.equal(result.value.assignedUserName, `QA-${w.runTag}-B-renamed`);
          } else {
            assert.equal(result.error.status, 404);
            assert.deepEqual(JSON.parse(JSON.stringify(await w.task(w.task1))), original);
          }
          await w.invariants();
        } finally { release.resolve(); clearTimeout(timer); await outcome; }
      }));
    }

    await t.test('RACE: unique email failure rolls back a competing user create/assignment', () => world(async (w) => {
      const body = { name: `QA-${w.runTag}-C`, email: `qa.${w.runTag}.race@example.com`, pendingTasks: [w.task1] };
      const results = await Promise.allSettled([w.service.createUser(body), w.service.createUser(body)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const failure = results.find((result) => result.status === 'rejected').reason;
      assert.ok(failure.code === 11000 || failure.status === 400);
      assert.equal(await User.countDocuments({ email: body.email }), 1);
      await w.invariants();
    }));

    await t.test('RACE/HTTP: retry commits one created task and sends only the post-commit result', () => world(async (w) => {
      const arrived = Promise.withResolvers();
      const release = Promise.withResolvers();
      let attempts = 0;
      const service = createRelationshipService({ beforeWrite: async ({ model }) => {
        if (model === 'User' && ++attempts === 1) { arrived.resolve(); await release.promise; }
      }, afterWrite: w.record });
      const server = createApp({ mutations: service }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const timer = setTimeout(() => { arrived.reject(new Error('HTTP retry barrier timed out')); release.resolve(); }, 10000);
      const request = fetch(`http://127.0.0.1:${server.address().port}/api/tasks`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w.body({ assignedUser: w.userB, completed: true })) });
      try {
        await arrived.promise;
        const user = await w.user(w.userB);
        await w.service.replaceUser(w.userB, { name: `QA-${w.runTag}-B-new`, email: user.email });
        release.resolve();
        const response = await request;
        assert.equal(response.status, 201);
        const { data } = await response.json();
        assert.ok(attempts >= 2);
        assert.equal(data.assignedUserName, `QA-${w.runTag}-B-new`);
        assert.equal(await Task.countDocuments({ name: w.body().name }), 1);
        assert.deepEqual((await w.request('GET', `tasks/${data._id}`)).data, data);
        await w.invariants();
      } finally {
        release.resolve(); clearTimeout(timer); await request;
        await new Promise((resolve) => server.close(resolve));
      }
    }));

    await t.test('ENV fixtures: refuse incomplete/foreign cleanup; accept explicit owned POST task IDs', () => world(async (w) => {
      const created = await w.service.createTask(w.body({ assignedUser: w.userA }));
      const foreign = await w.service.createTask(w.body({ name: `OTHER-${w.runTag}` }));
      const before = await w.snapshot();
      await assert.rejects(cleanFixtures(w), /cleanup refused/);
      await assert.rejects(cleanFixtures({ ...w, extraTaskIds: [w.task1, 'bad'] }), /Invalid/);
      await assert.rejects(cleanFixtures({ ...w, extraTaskIds: [String(created._id), String(foreign._id)] }), /run tag/);
      assert.deepEqual(await w.snapshot(), before);
      await cleanFixtures({ ...w, extraTaskIds: [String(created._id)] });
      await w.service.deleteTask(String(foreign._id));
      assert.deepEqual(await w.snapshot(), { users: [], tasks: [] });
    }));
  } finally { await mongoose.disconnect(); }
});
