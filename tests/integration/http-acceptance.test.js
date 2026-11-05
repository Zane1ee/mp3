'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const mongoose = require('mongoose');
const { isolatedTestTarget } = require('../../config/environment');
const { connectDatabase } = require('../../config/database');
const createApp = require('../../app');
const User = require('../../models/user');
const Task = require('../../models/task');
const { prepare, replay, cleanup } = require('../../scripts/acceptance');
const { parseApiResponse } = require('../../scripts/api-response');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

test('Atlas Round 5: API-only acceptance and scoped recovery against real HTTP', { timeout: 90000 }, async (t) => {
  await connectDatabase(isolatedTestTarget().uri);
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mp3-http-acceptance-'));
  const manifestPath = path.join(directory, 'run.json');
  const original = { users: await User.countDocuments({}), tasks: await Task.countDocuments({}) };
  async function request(method, resource, body) {
    const response = await fetch(`${origin}/api/${resource}`, { method,
      headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return parseApiResponse(response.status, await response.text(), method);
  }
  try {
    await t.test('all 75 reviewed requests replay over HTTP; five surviving records clean by API', async () => {
      const manifest = await prepare(origin, manifestPath);
      assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
      assert.equal(manifest.phase, 'prepared');
      await assert.rejects(prepare(origin, manifestPath), /already exists/);
      const result = await replay(manifestPath);
      assert.deepEqual(result, { requests: 75, assertions: 249 });
      await assert.rejects(replay(manifestPath), /fresh prepared/);
      assert.deepEqual(await cleanup(manifestPath), { users: 2, tasks: 3 });
      assert.equal(fs.existsSync(manifestPath), false);
    });

    await t.test('interrupted/manual POST with an unsaved ID is discovered and cleaned without deleting a foreign sentinel', async () => {
      const manifest = await prepare(origin, manifestPath);
      const foreign = await request('POST', 'users', { name: `sentinel-${manifest.runTag}`, email: `sentinel.${manifest.runTag}@example.com` });
      const sentinel = await User.findById(foreign.data._id).lean();
      try {
        const created = await request('POST', 'users', { name: `QA-${manifest.runTag}-C`, email: `qa.${manifest.runTag}.c@example.com` });
        assert.equal(created.status, 201);
        // Simulate Postman or a lost CLI response: this ID is not in the manifest.
        assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(manifestPath))).includes(created.data._id), false);
        assert.deepEqual(await cleanup(manifestPath), { users: 3, tasks: 3 });
        assert.equal((await request('GET', `users/${created.data._id}`)).status, 404);
        assert.deepEqual(await User.findById(foreign.data._id).lean(), sentinel);
      } finally { await request('DELETE', `users/${foreign.data._id}`); }
    });

    await t.test('foreign assignment blocks cleanup before its first deletion; restoration permits safe retry', async () => {
      const manifest = await prepare(origin, manifestPath);
      const foreign = await request('POST', 'tasks', { name: `foreign-${manifest.runTag}`,
        deadline: '2026-12-01', assignedUser: manifest.variables.userA });
      try {
        const before = JSON.stringify({ users: await User.find({}).sort({ _id: 1 }).lean(), tasks: await Task.find({}).sort({ _id: 1 }).lean() });
        await assert.rejects(cleanup(manifestPath), /foreign task/);
        const after = JSON.stringify({ users: await User.find({}).sort({ _id: 1 }).lean(), tasks: await Task.find({}).sort({ _id: 1 }).lean() });
        assert.equal(after, before, 'Safety refusal preserves all fields and versions, including foreign records.');
        assert.equal(fs.existsSync(manifestPath), true);
      } finally { await request('DELETE', `tasks/${foreign.data._id}`); }
      assert.deepEqual(await cleanup(manifestPath), { users: 2, tasks: 3 });
    });
    assert.deepEqual({ users: await User.countDocuments({}), tasks: await Task.countDocuments({}) }, original);
  } finally {
    try {
      if (fs.existsSync(manifestPath)) await cleanup(manifestPath);
      fs.rmSync(directory, { recursive: true });
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
    }
  }
});
