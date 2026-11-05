'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const mongoose = require('mongoose');
const { isolatedTestTarget } = require('../../config/environment');
const { connectDatabase } = require('../../config/database');
const { createRelationshipService } = require('../../lib/relationships');
const { parseApiResponse } = require('../../scripts/api-response');
const createApp = require('../../app');
const world = require('../helpers/world');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

test('Atlas Round 4 ATOM: rollback at every observed write boundary', { timeout: 120000 }, async (t) => {
  await connectDatabase(isolatedTestTarget().uri);
  const cases = [
    { label: 'Task POST', method: 'POST', resource: () => 'tasks', body: (w) => w.body({ assignedUser: w.userA }) },
    { label: 'Task PUT transfer', method: 'PUT', resource: (w) => `tasks/${w.task2}`, body: (w) => w.body({ assignedUser: w.userB }) },
    { label: 'User POST transfer', method: 'POST', resource: () => 'users', body: (w) => w.userBody({ pendingTasks: [w.task1, w.task2] }) },
    { label: 'User PUT transfer and completed rename', method: 'PUT', resource: (w) => `users/${w.userB}`,
      body: (w) => ({ name: `QA-${w.runTag}-B-new`, email: `qa.${w.runTag}.b@example.com`, pendingTasks: [w.task1, w.task2] }) },
    { label: 'Task DELETE', method: 'DELETE', resource: (w) => `tasks/${w.task2}` },
    { label: 'User DELETE pending and completed', method: 'DELETE', resource: (w) => `users/${w.userA}`,
      prepare: async (w) => { await w.service.replaceTask(w.task3, w.body({ assignedUser: w.userA, completed: true })); await w.invariants(); } },
  ];
  try {
    for (const scenario of cases) {
      await t.test(`ATOM ${scenario.label}: every actual write aborts without partial state`, async () => {
        async function invoke(w, failAt) {
          const trace = [];
          const mutations = createRelationshipService({ afterWrite: (event) => {
            w.record(event);
            assert.equal(event.session.inTransaction(), true);
            trace.push(event);
            if (trace.length === failAt) throw new Error('Private test fault after an actual persisted operation');
          } });
          const server = createApp({ mutations }).listen(0, '127.0.0.1');
          await once(server, 'listening');
          try {
            const body = scenario.body?.(w);
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${scenario.resource(w)}`, {
              method: scenario.method, headers: { 'Content-Type': 'application/json' },
              body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
            });
            const result = parseApiResponse(response.status, await response.text(), scenario.method);
            assert.ok(trace.length > 0);
            assert.equal(trace.every((event) => event.session === trace[0].session), true);
            assert.equal(trace.every((event) => event.session.hasEnded), true, 'Transaction session is ended on success and error');
            return { result, trace };
          } finally { await new Promise((resolve) => server.close(resolve)); }
        }
        let boundaries;
        // Discover the real successful path. Do not duplicate the service's
        // statement count or order as a hard-coded test implementation.
        await world(async (w) => {
          await scenario.prepare?.(w);
          const { result, trace } = await invoke(w, 0);
          assert.equal(result.status, scenario.method === 'DELETE' ? 204 : scenario.method === 'POST' ? 201 : 200);
          await w.invariants();
          boundaries = trace.length;
        });
        await world(async (w) => {
          await scenario.prepare?.(w);
          const original = await w.snapshot();
          for (let failAt = 1; failAt <= boundaries; failAt++) {
            const { result, trace } = await invoke(w, failAt);
            assert.equal(trace.length, failAt, 'Failure was injected at the intended real write');
            assert.deepEqual(result, { status: 500, message: 'An unexpected server error occurred', data: {} });
            assert.deepEqual(await w.snapshot(), original, `Rollback after write ${failAt}`);
            await w.invariants();
          }
        });
        console.log(`${scenario.label}: verified ${boundaries} actual rollback boundaries.`);
      });
    }
  } finally { await mongoose.disconnect(); }
});
