'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { isolatedTestTarget } = require('../../config/environment');
const { connectDatabase } = require('../../config/database');
const User = require('../../models/user');
const Task = require('../../models/task');
const world = require('../helpers/world');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

test('Atlas Round 4 QUERY: combinations, path boundaries and error precedence', { timeout: 90000 }, async (t) => {
  await connectDatabase(isolatedTestTarget().uri);
  try {
    for (const [label, key, value] of [
      ['empty projection path', 'select', { '': 1 }],
      ['parent/child projection collision', 'select', { name: 1, 'name.child': 1 }],
      ['empty sort path', 'sort', { '': 1 }],
      ['reserved projection field', 'select', { $bad: 1 }],
      ['misplaced positional field', 'select', { 'pendingTasks.$.name': 1 }],
    ]) {
      await t.test(`QUERY regression: ${label} is safe 400, including count=true`, () => world(async (w) => {
        for (const resource of ['users', 'tasks']) {
          for (const count of [false, true]) {
            const params = new URLSearchParams({ [key]: JSON.stringify(value), count: String(count) });
            await w.rejected('GET', `${resource}?${params}`, undefined, 400);
          }
          if (key === 'select') {
            const id = resource === 'users' ? w.userA : w.task1;
            await w.rejected('GET', `${resource}/${id}?select=${encodeURIComponent(JSON.stringify(value))}`, undefined, 400);
            await w.rejected('GET', `${resource}/bad-id?select=${encodeURIComponent(JSON.stringify(value))}`, undefined, 404);
          }
        }
      }));
    }

    for (const [resource, model] of [['users', User], ['tasks', Task]]) {
      await t.test(`QUERY ${resource}: all 64 parameter subsets obey independent expected results`, () => world(async (w) => {
        const all = JSON.parse(JSON.stringify(await model.find({}).lean()));
        const ids = resource === 'users' ? [w.userA] : [w.task2, w.task3];
        const keys = ['where', 'sort', 'select', 'skip', 'limit', 'count'];
        for (let mask = 0; mask < 64; mask++) {
          const use = (key) => Boolean(mask & (1 << keys.indexOf(key)));
          const values = { where: { _id: { $in: ids } }, sort: { name: 1, _id: 1 },
            select: { name: 1, _id: 0 }, skip: 1, limit: 1, count: true };
          const params = new URLSearchParams();
          for (const key of keys) if (use(key)) params.set(key, JSON.stringify(values[key]));
          const result = await w.request('GET', `${resource}?${params}`);
          assert.equal(result.status, 200, `Subset ${mask}`);
          let expected = use('where') ? all.filter((document) => ids.includes(document._id)) : all.slice();
          if (use('count')) { assert.equal(result.data, expected.length); continue; }
          const count = expected.length;
          const skip = use('skip') ? 1 : 0;
          const limit = use('limit') ? 1 : resource === 'tasks' ? 100 : Infinity;
          assert.equal(result.data.length, Math.min(Math.max(0, count - skip), limit));
          const project = (document) => use('select') ? { name: document.name } : document;
          if (use('sort')) {
            expected.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a._id.localeCompare(b._id));
            assert.deepEqual(result.data, expected.slice(skip, skip + limit).map(project));
          } else {
            // Without sort the contract promises no order. Check size/content,
            // never infer which arbitrary member an unsorted page must contain.
            const candidates = new Set(expected.map((document) => JSON.stringify(project(document))));
            for (const document of result.data) assert.ok(candidates.has(JSON.stringify(document)));
          }
        }
      }));
    }

    await t.test('QUERY: both resources validate every recognized JSON value and ignore unknown/member-only noise', () => world(async (w) => {
      for (const resource of ['users', 'tasks']) {
        for (const key of ['where', 'sort', 'select', 'skip', 'limit', 'count']) {
          await w.rejected('GET', `${resource}?${key}=NOT_JSON`, undefined, 400);
          await w.rejected('GET', `${resource}?${key}=0&${key}=1`, undefined, 400);
        }
        const id = resource === 'users' ? w.userA : w.task1;
        const query = new URLSearchParams({ where: 'NOT_JSON', sort: '[]', skip: '-1', limit: 'bad', count: 'null', select: '{"name":1,"_id":0}' });
        const member = await w.request('GET', `${resource}/${id}?${query}`);
        assert.equal(member.status, 200);
        assert.deepEqual(Object.keys(member.data), ['name']);
        const scoped = new URLSearchParams({ where: JSON.stringify({ _id: id }), unexpected: 'NOT_JSON' });
        const list = await w.request('GET', `${resource}?${scoped}`);
        assert.equal(list.status, 200);
        assert.equal(list.data.length, 1);
      }
    }));

    await t.test('QUERY: exclusion projection, _id exception, empty maps and Mongo operators remain usable', () => world(async (w) => {
      for (const resource of ['users', 'tasks']) {
        const id = resource === 'users' ? w.userA : w.task1;
        for (const select of [{}, { _id: 0 }, { name: 0, _id: 1 }]) {
          const result = await w.request('GET', `${resource}/${id}?select=${encodeURIComponent(JSON.stringify(select))}`);
          assert.equal(result.status, 200);
          if (select._id === 0) assert.equal(result.data._id, undefined);
          else assert.equal(result.data._id, id);
          if (select.name === 0) assert.equal(result.data.name, undefined);
        }
        const where = { $and: [{ _id: { $in: [id] } }, { name: { $ne: 'missing' } }] };
        const result = await w.request('GET', `${resource}?where=${encodeURIComponent(JSON.stringify(where))}&count=true`);
        assert.equal(result.data, 1);
      }
      const params = new URLSearchParams({ where: JSON.stringify({ _id: w.userA, pendingTasks: w.task2 }),
        select: JSON.stringify({ 'pendingTasks.$': 1, _id: 0 }) });
      const positional = await w.request('GET', `users?${params}`);
      assert.equal(positional.status, 200);
      assert.deepEqual(positional.data, [{ pendingTasks: [w.task2] }]);
    }));
  } finally { await mongoose.disconnect(); }
});
