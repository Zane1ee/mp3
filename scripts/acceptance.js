'use strict';

// API-only acceptance tools: no dotenv, direct database access or public seed route.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const vm = require('node:vm');
const { parseApiResponse } = require('./api-response');
const root = path.join(__dirname, '..');
const defaultManifest = path.join(root, '.local', 'http-acceptance.json');
const collectionPath = path.join(root, 'docs', 'mp3.postman_collection.json');
const idPattern = /^[a-f0-9]{24}$/;

function originTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Provide a valid API origin without /api.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  assert.ok(url.protocol === 'https:' || (local && url.protocol === 'http:'), 'Remote API origins require HTTPS.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
    'Use the origin only: no credentials, path, query or fragment.');
  assert.ok(!/YOUR-|<|>/i.test(value), 'Replace the example origin with the actual address.');
  return url.origin;
}

function load(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, 1);
  assert.match(manifest.runTag, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(originTarget(manifest.origin), manifest.origin);
  assert.equal(manifest.variables.runTag, manifest.runTag);
  assert.equal(manifest.variables.apiBase, `${manifest.origin}/api`);
  return manifest;
}

function save(manifestPath, manifest, flag = 'w') {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag, mode: 0o600 });
}

async function response(origin, resource, options = {}) {
  const url = new URL(`${origin}/api${resource}`);
  assert.equal(url.origin, origin, 'Acceptance cannot redirect to another origin.');
  let result;
  try {
    result = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(60000) });
  } catch { throw new Error('API request failed or timed out. Inspect service readiness; do not blindly retry a POST.'); }
  const text = await result.text();
  return { result, text };
}

async function jsonRequest(origin, method, resource, body) {
  const { result, text } = await response(origin, resource, { method,
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return parseApiResponse(result.status, text, method);
}

async function prepare(origin, manifestPath = defaultManifest) {
  origin = originTarget(origin);
  assert.equal(fs.existsSync(manifestPath), false, 'An acceptance run already exists. Clean it before creating another.');
  const health = await jsonRequest(origin, 'GET', '/health');
  assert.equal(health.status, 200, 'Warm the service and require database readiness before preparing fixtures.');
  assert.equal(health.data.ready, true);
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const runTag = randomUUID();
  const manifest = { version: 1, origin, runTag, phase: 'preparing',
    variables: Object.fromEntries(collection.variable.map(({ key }) => [key, ''])) };
  Object.assign(manifest.variables, { apiBase: `${origin}/api`, runTag });
  // Persist the run tag BEFORE the first POST, so a lost response is recoverable.
  save(manifestPath, manifest, 'wx');
  const create = async (resource, variable, body) => {
    const result = await jsonRequest(origin, 'POST', `/${resource}`, body);
    assert.equal(result.status, 201, `Preparing ${variable} must create a new document.`);
    assert.match(result.data._id, idPattern);
    manifest.variables[variable] = result.data._id;
    save(manifestPath, manifest);
  };
  for (const label of ['A', 'B']) await create('users', `user${label}`, {
    name: `QA-${runTag}-${label}`, email: `qa.${runTag}.${label.toLowerCase()}@example.com`,
  });
  const task = (suffix, extra = {}) => ({ name: `QA-${runTag}-${suffix}`,
    deadline: '2026-12-01T12:00:00Z', ...extra });
  await create('tasks', 'task1', task('01'));
  await create('tasks', 'task2', task('02', { assignedUser: manifest.variables.userA }));
  await create('tasks', 'task3', task('03', { completed: true, assignedUser: manifest.variables.userB }));
  manifest.phase = 'prepared';
  save(manifestPath, manifest);
  return manifest;
}

// Replay only this repository's reviewed pm scripts. This is not a general Postman runtime.
async function replay(manifestPath = defaultManifest, progress = () => {}) {
  const manifest = load(manifestPath);
  assert.equal(manifest.phase, 'prepared', 'Replay requires fresh prepared fixtures; clean before another run.');
  manifest.phase = 'running';
  save(manifestPath, manifest);
  const variables = manifest.variables;
  let assertions = 0;
  const plain = (value) => JSON.parse(JSON.stringify(value));
  function expect(value) {
    const chain = { eql: (other) => assert.deepEqual(plain(value), plain(other)),
      a: (type) => assert.equal(typeof value, type), length: (size) => assert.equal(value.length, size) };
    chain.to = chain.be = chain.have = chain;
    return chain;
  }
  function environment(result, text) {
    return {
      collectionVariables: { get: (key) => variables[key], set: (key, value) => { variables[key] = value; } },
      test(name, callback) { try { callback(); assertions++; } catch { throw new Error(`Assertion failed: ${name}`); } },
      expect, response: result && { code: result.status, json: () => JSON.parse(text), text: () => text,
        to: { have: { status: (status) => assert.equal(result.status, status) } } },
    };
  }
  const substitute = (text) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    assert.ok(variables[key], `Missing collection variable: ${key}`);
    return variables[key];
  });
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  let requests = 0;
  for (const item of collection.item) {
    progress(item.name);
    try {
      for (const event of item.event ?? []) if (event.listen === 'prerequest')
        vm.runInNewContext(event.script.exec.join('\n'), { pm: environment() }, { timeout: 1000 });
      const url = new URL(substitute(item.request.url.raw));
      assert.equal(url.origin, manifest.origin);
      assert.ok(url.pathname === '/api' || url.pathname.startsWith('/api/'));
      const headers = Object.fromEntries((item.request.header ?? []).map(({ key, value }) => [key, substitute(value)]));
      let body;
      if (item.request.body?.mode === 'raw') body = substitute(item.request.body.raw);
      if (item.request.body?.mode === 'urlencoded') body = new URLSearchParams(
        item.request.body.urlencoded.map(({ key, value }) => [key, substitute(value)]));
      const { result, text } = await response(manifest.origin, url.pathname.slice(4) + url.search,
        { method: item.request.method, headers, body });
      for (const event of item.event ?? []) if (event.listen === 'test')
        vm.runInNewContext(event.script.exec.join('\n'), { pm: environment(result, text) }, { timeout: 1000 });
      requests++;
    } catch (error) { throw new Error(`${item.name}: ${error.message}`); }
    finally { save(manifestPath, manifest); }
  }
  manifest.phase = 'replayed';
  manifest.result = { requests, assertions };
  save(manifestPath, manifest);
  return manifest.result;
}

async function cleanup(manifestPath = defaultManifest) {
  const manifest = load(manifestPath);
  const { origin, runTag } = manifest;
  const prefix = `QA-${runTag}-`;
  async function find(resource, where) {
    const query = new URLSearchParams({ where: JSON.stringify(where), limit: '0' });
    const result = await jsonRequest(origin, 'GET', `/${resource}?${query}`);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data));
    return result.data;
  }
  // Find only this random run's prefix, including POSTs whose response was lost
  // or whose ID exists only in Postman. Never enumerate or wipe the database.
  const users = await find('users', { name: { $regex: `^${prefix}` } });
  const tasks = await find('tasks', { name: { $regex: `^${prefix}` } });
  const userIds = users.map((user) => user._id);
  const taskIds = tasks.map((task) => task._id);
  for (const user of users) {
    assert.match(user._id, idPattern);
    assert.ok(user.name.startsWith(prefix) && user.email.startsWith(`qa.${runTag}.`) && user.email.endsWith('@example.com'),
      'Cleanup refused a user without matching name and email ownership.');
    assert.ok(user.pendingTasks.every((id) => taskIds.includes(id)), 'Cleanup refused a reference to a foreign task.');
  }
  for (const task of tasks) {
    assert.match(task._id, idPattern);
    assert.ok(task.name.startsWith(prefix));
    assert.ok(!task.assignedUser || userIds.includes(task.assignedUser), 'Cleanup refused a reference to a foreign user.');
  }
  const assigned = userIds.length ? await find('tasks', { assignedUser: { $in: userIds } }) : [];
  assert.ok(assigned.every((task) => taskIds.includes(task._id)), 'Cleanup refused a foreign task assigned to an owned user.');
  // Preflight all links before deleting anything; stop other manual writes first.
  for (const [resource, ids] of [['tasks', taskIds], ['users', userIds]]) for (const id of ids) {
    const deleted = await jsonRequest(origin, 'DELETE', `/${resource}/${id}`);
    assert.deepEqual(deleted, { status: 204 });
    assert.equal((await jsonRequest(origin, 'GET', `/${resource}/${id}`)).status, 404);
  }
  assert.equal((await find('users', { name: { $regex: `^${prefix}` } })).length, 0);
  assert.equal((await find('tasks', { name: { $regex: `^${prefix}` } })).length, 0);
  fs.unlinkSync(manifestPath);
  return { users: userIds.length, tasks: taskIds.length };
}

async function main(args) {
  const [command, option, value, ...extra] = args;
  assert.ok(['prepare', 'run', 'cleanup'].includes(command), 'Use prepare --origin URL, run --origin URL, or cleanup.');
  assert.equal(extra.length, 0);
  if (command === 'cleanup') assert.equal(option, undefined, 'Cleanup uses its saved origin; do not override it.');
  else assert.equal(option, '--origin', 'An explicit --origin is required; no database URI is used.');
  fs.mkdirSync(path.dirname(defaultManifest), { recursive: true, mode: 0o700 });
  const lockPath = `${defaultManifest}.lock`;
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  try {
    if (command === 'cleanup') {
      console.log('Owned API fixture cleanup:', await cleanup());
    } else {
      const manifest = await prepare(value);
      if (command === 'prepare') {
        console.log('Fresh API fixtures ready. Copy these into Postman collection variables:');
        for (const key of ['apiBase', 'runTag', 'userA', 'userB', 'task1', 'task2', 'task3']) console.log(`${key}=${manifest.variables[key]}`);
        console.log('Clear other saved resource/date/snapshot variables before the manual run.');
      } else {
        let failure;
        try {
          const result = await replay(defaultManifest, (name) => console.log(`Checking ${name}`));
          console.log('Automated HTTP/VM collection replay (not owner manual acceptance):', result);
        } catch (error) { failure = error; }
        try { console.log('Owned API fixture cleanup:', await cleanup()); }
        catch (error) { console.error('Cleanup incomplete; keep .local/http-acceptance.json for recovery.'); throw error; }
        if (failure) throw failure;
      }
    }
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

if (require.main === module) main(process.argv.slice(2)).catch((error) => {
  console.error(`Acceptance failed: ${error.message}`);
  console.error('Keep any existing manifest and run cleanup after resolving service availability. Do not retry preparation blindly.');
  process.exitCode = 1;
});

module.exports = { originTarget, prepare, replay, cleanup };
