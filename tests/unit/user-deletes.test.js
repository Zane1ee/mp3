'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const createApp = require('../../app');
const { ApiError } = require('../../lib/http');

async function withServer(mutations, run) {
  const server = createApp({ mutations }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}/api`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('HTTP user writes: JSON/form dispatch and committed resource response', async () => {
  const calls = [];
  const result = { _id: 'abcdef123456789012345678', name: 'Committed user', email: 'member@example.com' };
  await withServer({
    async createUser(...args) { calls.push(['createUser', ...args]); return result; },
    async replaceUser(...args) { calls.push(['replaceUser', ...args]); return result; },
  }, async (base) => {
    const body = { name: 'Input', email: 'member@example.com', pendingTasks: [] };
    const created = await fetch(`${base}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { message: 'User created', data: result });
    const form = { name: 'Input', email: 'member@example.com', pendingTasks: '[]' };
    const replaced = await fetch(`${base}/users/${result._id}`, { method: 'PUT', body: new URLSearchParams(form) });
    assert.equal(replaced.status, 200);
    assert.deepEqual(await replaced.json(), { message: 'User updated', data: result });
    assert.deepEqual(calls, [['createUser', body, false], ['replaceUser', result._id, form, true]]);
  });
});

test('HTTP deletes: D6 uses 200 JSON, one resource ID and one service call', async () => {
  const id = 'abcdef123456789012345678';
  for (const [resource, method, label] of [['users', 'deleteUser', 'User'], ['tasks', 'deleteTask', 'Task']]) {
    const calls = [];
    await withServer({ [method]: async (...args) => { calls.push(args); return []; } }, async (base) => {
      const response = await fetch(`${base}/${resource}/${id}`, { method: 'DELETE' });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.deepEqual(await response.json(), { message: `${label} deleted`, data: [] });
      assert.deepEqual(calls, [[id]]);
    });
  }
});

test('HTTP user/deletes: safe known errors, private unexpected failures and parser precedence', async () => {
  await withServer({
    createUser: async () => { throw new ApiError(400, 'Email is already in use'); },
    replaceUser: async () => { throw new Error('private password mongodb+srv://secret'); },
    deleteUser: async () => { throw new ApiError(404, 'User not found'); },
    deleteTask: async () => { throw new Error('private MongoServerError stack'); },
  }, async (base) => {
    for (const [method, resource, status, message] of [
      ['POST', 'users', 400, 'Email is already in use'],
      ['PUT', 'users/bad-id', 500, 'An unexpected server error occurred'],
      ['DELETE', 'users/bad-id', 404, 'User not found'],
      ['DELETE', 'tasks/bad-id', 500, 'An unexpected server error occurred'],
    ]) {
      const response = await fetch(`${base}/${resource}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { message, data: {} });
    }
    const malformed = await fetch(`${base}/users/bad-id`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"name":' });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { message: 'Invalid request body', data: {} });
  });
});
