'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createFixtures } = require('../../scripts/fixtures');
const { createRelationshipService } = require('../../lib/relationships');
const { parseApiResponse } = require('../../scripts/api-response');
const createApp = require('../../app');
const User = require('../../models/user');
const Task = require('../../models/task');

module.exports = async function world(run) {
  const fixture = await createFixtures();
  const owned = { User: new Set([fixture.userA, fixture.userB]), Task: new Set([fixture.task1, fixture.task2, fixture.task3]) };
  const record = ({ model, id }) => owned[model].add(id);
  const service = createRelationshipService({ afterWrite: record });
  const server = createApp({ mutations: service }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const state = { ...fixture, owned, record, service, base,
    userBody: (extra = {}) => ({ name: `QA-${fixture.runTag}-new-user`, email: `qa.${fixture.runTag}.new@example.com`, ...extra }),
    body: (extra = {}) => ({ name: `QA-${fixture.runTag}-created`, deadline: '2026-12-01T12:00:00Z', ...extra }),
    user: (id) => User.findById(id).lean(),
    task: (id) => Task.findById(id).lean(),
    async snapshot() {
      return JSON.parse(JSON.stringify({
        users: await User.find({ _id: { $in: [...owned.User] } }).sort({ _id: 1 }).lean(),
        tasks: await Task.find({ _id: { $in: [...owned.Task] } }).sort({ _id: 1 }).lean(),
      }));
    },
    async invariants() {
      const { users, tasks } = await state.snapshot();
      const userMap = new Map(users.map((user) => [user._id, user]));
      const taskMap = new Map(tasks.map((task) => [task._id, task]));
      for (const user of users) {
        assert.equal(new Set(user.pendingTasks).size, user.pendingTasks.length);
        for (const id of user.pendingTasks) {
          const task = taskMap.get(id);
          assert.ok(task, 'No missing task reference');
          assert.equal(task.completed, false);
          assert.equal(task.assignedUser, user._id);
        }
      }
      for (const task of tasks) {
        if (!task.assignedUser) { assert.equal(task.assignedUserName, 'unassigned'); continue; }
        const user = userMap.get(task.assignedUser);
        assert.ok(user, 'No missing user reference');
        assert.equal(task.assignedUserName, user.name);
        assert.equal(user.pendingTasks.filter((id) => id === task._id).length, task.completed ? 0 : 1);
      }
    },
    async request(method, resource, body, options = {}) {
      const response = await fetch(`${base}/${resource}`, {
        method, signal: AbortSignal.timeout(20000),
        headers: options.form ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : options.form ? new URLSearchParams(body) : JSON.stringify(body),
      });
      const result = parseApiResponse(response.status, await response.text(), method);
      if (options.check !== false && result.status < 300 && method !== 'GET') await state.invariants();
      return result;
    },
    async rejected(method, resource, body, status, options) {
      const before = await state.snapshot();
      const result = await state.request(method, resource, body, options);
      assert.equal(result.status, status);
      assert.deepEqual(result.data, {});
      assert.doesNotMatch(result.message, /CastError|MongoServerError|mongodb|password|stack/);
      assert.deepEqual(await state.snapshot(), before, 'Rejected write preserves every field including __v');
      return result;
    },
  };
  try { await run(state); await state.invariants(); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    await Task.deleteMany({ _id: { $in: [...owned.Task] } });
    await User.deleteMany({ _id: { $in: [...owned.User] } });
  }
};
