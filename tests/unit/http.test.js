'use strict';

// Transport/dispatch tests use model doubles. Real Mongo behavior is covered
// separately by tests/integration/reads.test.js and must not be inferred here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const createApp = require('../../app');

const id = 'abcdef123456789012345678';

function modelDouble({ data = [{ name: 'Fixture' }], exists = true, count = 7, failure } = {}) {
  const calls = [];
  function query(result) {
    return {
      sort(value) { calls.push(['sort', value]); return this; },
      select(value) { calls.push(['select', value]); return this; },
      skip(value) { calls.push(['skip', value]); return this; },
      limit(value) { calls.push(['limit', value]); return this; },
      then(resolve, reject) { return (failure ? Promise.reject(failure) : Promise.resolve(result)).then(resolve, reject); },
    };
  }
  return {
    calls,
    find(where) { calls.push(['find', where]); return query(data); },
    countDocuments(where) { calls.push(['countDocuments', where]); return query(count); },
    async exists(where) { calls.push(['exists', where]); if (failure) throw failure; return exists ? { _id: id } : null; },
    findById(value) { calls.push(['findById', value]); return query(data[0]); },
  };
}

async function withServer(options, run) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function url(base, resource, parameters) {
  const result = new URL(`/api/${resource}`, base);
  for (const [key, value] of Object.entries(parameters)) result.searchParams.set(key, value);
  return result;
}

test('HTTP: service/health/CORS/OPTIONS and unavailable DB use safe consistent responses', async () => {
  const model = modelDouble();
  let ready = true;
  await withServer({ models: { User: model, Task: model }, ready: () => ready }, async (base) => {
    const home = await fetch(`${base}/api`);
    assert.deepEqual(await home.json(), { message: 'OK', data: { service: 'cs409-mp3-api' } });
    assert.equal(home.headers.get('access-control-allow-origin'), '*');
    assert.equal(home.headers.get('x-powered-by'), null);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    ready = false;
    const unavailable = await fetch(`${base}/api/health`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { message: 'Database unavailable', data: { ready: false } });
    const options = await fetch(`${base}/api/tasks`, { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.equal(await options.text(), '');
    assert.match(options.headers.get('access-control-allow-methods'), /PUT/);
  });
});

for (const resource of ['users', 'tasks']) {
  test(`HTTP ${resource}: list delegates all operations and count uses only where`, async () => {
    const model = modelDouble();
    await withServer({ models: { User: model, Task: model } }, async (base) => {
      const parameters = { where: '{"name":"Fixture"}', sort: '{"name":1}',
        select: '{"name":1,"_id":0}', skip: '1', limit: '2', count: 'false' };
      const response = await fetch(url(base, resource, parameters));
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data, [{ name: 'Fixture' }]);
      assert.deepEqual(model.calls, [['find', { name: 'Fixture' }], ['sort', { name: 1 }],
        ['select', { name: 1, _id: 0 }], ['skip', 1], ['limit', 2]]);
      model.calls.length = 0;
      const count = await fetch(url(base, resource, { ...parameters, count: 'true' }));
      assert.equal((await count.json()).data, 7);
      assert.deepEqual(model.calls, [['countDocuments', { name: 'Fixture' }]]);
    });
  });

  test(`HTTP ${resource}: members ignore every irrelevant malformed parameter`, async () => {
    const model = modelDouble();
    await withServer({ models: { User: model, Task: model } }, async (base) => {
      const response = await fetch(url(base, `${resource}/${id}`, { where: 'NOT_JSON', sort: 'bad',
        skip: '-1', limit: 'bad', count: 'bad', select: '{"name":1,"_id":0}' }));
      assert.equal(response.status, 200);
      assert.deepEqual(model.calls, [['exists', { _id: id }], ['findById', id], ['select', { name: 1, _id: 0 }]]);
    });
  });

  test(`HTTP ${resource}: invalid/missing member precedes invalid select`, async () => {
    const model = modelDouble({ exists: false });
    await withServer({ models: { User: model, Task: model } }, async (base) => {
      for (const member of ['not-an-id', id]) {
        const response = await fetch(url(base, `${resource}/${member}`, { select: 'NOT_JSON' }));
        assert.equal(response.status, 404);
        assert.deepEqual((await response.json()).data, {});
      }
      assert.deepEqual(model.calls, [['exists', { _id: id }]]);
    });
  });

  test(`HTTP ${resource}: existing member with invalid select is 400`, async () => {
    const model = modelDouble();
    await withServer({ models: { User: model, Task: model } }, async (base) => {
      const response = await fetch(url(base, `${resource}/${id}`, { select: 'NOT_JSON' }));
      assert.equal(response.status, 400);
      assert.deepEqual(model.calls, [['exists', { _id: id }]]);
    });
  });
}

test('HTTP: malformed/repeated collection input fails before any model operation', async () => {
  const model = modelDouble();
  await withServer({ models: { User: model, Task: model } }, async (base) => {
    for (const query of ['where=NOT_JSON', 'limit=1&limit=2', 'count=true&select=NOT_JSON', 'count=null']) {
      const response = await fetch(`${base}/api/tasks?${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual((await response.json()).data, {});
    }
    assert.deepEqual(model.calls, []);
  });
});

test('HTTP: unknown paths, malformed body and internal DB failures do not leak details', async () => {
  const model = modelDouble({ failure: new Error('private-password at mongodb+srv://secret') });
  await withServer({ models: { User: model, Task: model } }, async (base) => {
    const unknown = await fetch(`${base}/api/does-not-exist`);
    assert.equal(unknown.status, 404);
    const malformed = await fetch(`${base}/api/users`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{"name":' });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { message: 'Invalid request body', data: {} });
    const failure = await fetch(`${base}/api/tasks`);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { message: 'An unexpected server error occurred', data: {} });
  });
});

test('ENV startup: missing DB configuration exits without falsely listening', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', '..'), encoding: 'utf8',
    env: { ...process.env, MONGODB_URI: '', TEST_MONGODB_URI: '', PORT: '0' }, timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MONGODB_URI must be configured/);
  assert.doesNotMatch(result.stdout, /Server ready/);
});
