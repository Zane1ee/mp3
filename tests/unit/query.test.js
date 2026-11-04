'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectionQuery, projection, buildFind } = require('../../lib/query');
const User = require('../../models/user');
const Task = require('../../models/task');

test('QUERY defaults: tasks 100, users unlimited, explicit limit zero', () => {
  assert.equal(collectionQuery({}, 'tasks').limit, 100);
  assert.equal(collectionQuery({}, 'users').limit, 0);
  assert.equal(collectionQuery({ limit: '0' }, 'tasks').limit, 0);
  assert.equal(collectionQuery({ count: 'false' }, 'tasks').count, false);
});

test('QUERY: all parameters compose into a real Mongoose query without executing a database request', () => {
  const options = collectionQuery({ where: '{"completed":false}', sort: '{"name":-1}',
    select: '{"name":1,"_id":0}', skip: '60', limit: '20', count: 'false' }, 'tasks');
  const query = buildFind(Task, options);
  assert.deepEqual(query.getFilter(), { completed: false });
  assert.deepEqual(query.getOptions(), { sort: { name: -1 }, skip: 60, limit: 20 });
  assert.deepEqual(query.projection(), { name: 1, _id: 0 });
});

test('QUERY: documented $in survives and casts to MongoDB ObjectIds', () => {
  const id = 'abcdef123456789012345678';
  const query = buildFind(User, collectionQuery({ where: JSON.stringify({ _id: { $in: [id] } }) }, 'users'));
  query.cast(User);
  assert.equal(query.getFilter()._id.$in[0].toHexString(), id);
});

for (const [key, value] of [
  ['where', 'NOT_JSON'], ['where', '[]'], ['where', 'null'], ['sort', '{"name":0}'],
  ['sort', '{"name":true}'], ['select', '{"name":2}'], ['select', '{"name":1,"email":0}'],
  ['skip', '-1'], ['skip', '1.5'], ['limit', '"2"'], ['limit', '9007199254740992'],
  ['count', '"false"'], ['count', '0'], ['count', 'null'], ['count', 'TRUE'],
  ['limit', ['1', '2']],
  ['select', '{"":1}'], ['sort', '{"":1}'],
  ['select', '{"name":1,"name.child":1}'], ['select', '{"name.child":0,"name":0}'],
  ['select', '{".name":1}'], ['sort', '{"name..child":1}'],
  ['sort', JSON.stringify({ ['name\0child']: 1 })],
  ['select', '{"$bad":1}'], ['select', '{"pendingTasks.$.name":1}'],
  ['select', '{"pendingTasks.$":0}'], ['select', '{"first.$":1,"second.$":1}'],
]) test(`QUERY rejects ${key}=${JSON.stringify(value)}`, () => {
  assert.throws(() => collectionQuery({ [key]: value }, 'tasks'), (error) => error.status === 400);
});

test('QUERY: validate paths even for count=true; preserve valid nested and positional fields', () => {
  for (const [key, value] of [['sort', { '': 1 }], ['select', { name: 1, 'name.child': 1 }]]) {
    assert.throws(() => collectionQuery({ count: 'true', [key]: JSON.stringify(value) }, 'users'), (error) => error.status === 400);
  }
  for (const value of [{ 'profile.first': 1, 'profile.last': 1 }, { 'pendingTasks.$': 1 }, { 'reference.$id': 1 }]) {
    assert.deepEqual(projection({ select: JSON.stringify(value) }), value);
  }
});

test('QUERY projection: inclusion/exclusion with _id exception and empty maps', () => {
  for (const value of [{}, { _id: 0 }, { name: 1, _id: 0 }, { name: 0, _id: 1 }]) {
    assert.deepEqual(projection({ select: JSON.stringify(value) }), value);
  }
  assert.deepEqual(collectionQuery({ unknown: 'NOT_JSON' }, 'users').where, {});
});
