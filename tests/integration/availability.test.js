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

test('Atlas Round 4 ENV: actual closed connection fails safely without mutating data', { timeout: 45000 }, async () => {
  const target = isolatedTestTarget();
  await connectDatabase(target.uri);
  try {
    await world(async (w) => {
      const connection = mongoose.createConnection(target.uri, { serverSelectionTimeoutMS: 10000, bufferCommands: false });
      let server;
      try {
        await connection.asPromise().catch(() => { throw new Error('Availability prerequisite connection failed'); });
        const models = { User: connection.model('User', User.schema), Task: connection.model('Task', Task.schema) };
        await models.User.init();
        await models.Task.init();
        await connection.db.command({ ping: 1 });
        const original = await w.snapshot();
        await connection.close();
        assert.equal(connection.readyState, 0);
        server = createApp({ models, mutations: createRelationshipService({ connection, models }),
          ready: () => connection.readyState === 1 }).listen(0, '127.0.0.1');
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}/api`;
        const health = await fetch(`${base}/health`);
        assert.equal(health.status, 503);
        assert.deepEqual(await health.json(), { message: 'Database unavailable', data: { ready: false } });
        const cases = [
          ['GET', 'users'], ['POST', 'users', w.userBody()], ['GET', `users/${w.userA}`],
          ['PUT', `users/${w.userA}`, w.userBody()], ['DELETE', `users/${w.userA}`],
          ['GET', 'tasks'], ['POST', 'tasks', w.body()], ['GET', `tasks/${w.task1}`],
          ['PUT', `tasks/${w.task1}`, w.body()], ['DELETE', `tasks/${w.task1}`],
        ];
        for (const [method, resource, body] of cases) {
          const response = await fetch(`${base}/${resource}`, { method, headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
          assert.equal(response.status, 500, `${method} ${resource}`);
          assert.deepEqual(await response.json(), { message: 'An unexpected server error occurred', data: {} });
        }
        assert.deepEqual(await w.snapshot(), original);
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await connection.close();
      }
    });
  } finally { await mongoose.disconnect(); }
});
