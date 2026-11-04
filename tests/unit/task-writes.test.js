'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const createApp = require('../../app');

async function withServer(mutations, run) {
  const server = createApp({ mutations }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}/api`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('HTTP task writes: dispatch JSON/form bodies and return the committed service result', async () => {
  const calls = [];
  const result = { _id: 'abcdef123456789012345678', name: 'Committed task' };
  const mutations = {
    async createTask(...args) { calls.push(['createTask', ...args]); return result; },
    async replaceTask(...args) { calls.push(['replaceTask', ...args]); return result; },
  };
  await withServer(mutations, async (base) => {
    const body = { name: 'Input', deadline: '2026-12-01', completed: false };
    const created = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { message: 'Task created', data: result });
    const replaced = await fetch(`${base}/tasks/${result._id}`, { method: 'PUT', body: new URLSearchParams({ name: 'Input', deadline: '2026-12-01', completed: 'false' }) });
    assert.equal(replaced.status, 200);
    assert.deepEqual(await replaced.json(), { message: 'Task updated', data: result });
    assert.deepEqual(calls, [
      ['createTask', body, false],
      ['replaceTask', result._id, { name: 'Input', deadline: '2026-12-01', completed: 'false' }, true],
    ]);
  });
});

test('HTTP task writes: parser errors precede dispatch; unexpected transaction failures stay private', async () => {
  let calls = 0;
  const fail = async () => { calls++; throw new Error('private database password and mongodb+srv://secret'); };
  await withServer({ createTask: fail, replaceTask: fail }, async (base) => {
    const malformed = await fetch(`${base}/tasks/not-an-id`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"name":' });
    assert.equal(malformed.status, 400);
    assert.equal(calls, 0);
    const failure = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { message: 'An unexpected server error occurred', data: {} });
    assert.equal(calls, 1);
  });
});
