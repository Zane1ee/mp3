'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUser, normalizeTask, validDate } = require('../../lib/validation');
const { ApiError } = require('../../lib/http');
const User = require('../../models/user');
const Task = require('../../models/task');

const id = 'ABCDEF123456789012345678';
const user = { name: ' Alice ', email: ' Alice@example.com ' };
const task = { name: ' Read ', deadline: '2026-12-01T12:00:00Z' };
const badRequest = (error) => error instanceof ApiError && error.status === 400;

test('DATA-U: trim, preserve email case, default pending list and discard server-owned inputs', () => {
  assert.deepEqual(normalizeUser({ ...user, _id: id, dateCreated: '2000-01-01', __v: 99, admin: true }),
    { name: 'Alice', email: 'Alice@example.com', pendingTasks: [] });
});

test('DATA-U: canonical unique reference IDs; explicit form array decoding', () => {
  assert.deepEqual(normalizeUser({ ...user, pendingTasks: [id, id.toLowerCase()] }).pendingTasks, [id.toLowerCase()]);
  assert.deepEqual(normalizeUser({ ...user, pendingTasks: JSON.stringify([id]) }, true).pendingTasks, [id.toLowerCase()]);
  assert.throws(() => normalizeUser({ ...user, pendingTasks: JSON.stringify([id]) }), badRequest);
});

for (const [label, change] of [
  ['missing name', { name: undefined }], ['numeric name', { name: 42 }],
  ['empty name', { name: ' ' }], ['missing email', { email: undefined }],
  ['invalid email', { email: 'not-an-address' }], ['null email', { email: null }],
  ['null pendingTasks', { pendingTasks: null }], ['scalar pendingTasks', { pendingTasks: id }],
  ['malformed ID', { pendingTasks: ['bad-id'] }], ['object ID value', { pendingTasks: [{}] }],
]) test(`VALID-U: rejects ${label}`, () => assert.throws(() => normalizeUser({ ...user, ...change }), badRequest));

test('DATA-T: complete replacement defaults; derives names later only for assigned tasks', () => {
  assert.deepEqual(normalizeTask({ ...task, dateCreated: '2000-01-01', extra: true }), {
    name: 'Read', deadline: new Date('2026-12-01T12:00:00Z'), description: '',
    completed: false, assignedUser: '', assignedUserName: 'unassigned',
  });
  const assigned = normalizeTask({ ...task, assignedUser: id });
  assert.equal(assigned.assignedUser, id.toLowerCase());
  assert.equal(assigned.assignedUserName, undefined);
  assert.equal(normalizeTask({ ...task, completed: 'false' }, true).completed, false);
  assert.equal(normalizeTask({ ...task, completed: 'true' }, true).completed, true);
});

for (const [label, change] of [
  ['missing deadline', { deadline: undefined }], ['numeric deadline', { deadline: 123 }],
  ['invalid deadline', { deadline: 'not-a-date' }], ['null completed', { completed: null }],
  ['string completed', { completed: 'false' }], ['numeric completed', { completed: 0 }],
  ['null description', { description: null }], ['invalid assignedUser', { assignedUser: 'bad' }],
  ['null assignedUserName', { assignedUserName: null }],
]) test(`VALID-T: rejects ${label}`, () => assert.throws(() => normalizeTask({ ...task, ...change }), badRequest));

test('VALID: arrays/null are not resource bodies', () => {
  for (const body of [null, [], true, 'string']) {
    assert.throws(() => normalizeUser(body), badRequest);
    assert.throws(() => normalizeTask(body), badRequest);
  }
});

test('DATA date: invalid calendar rollover, leap years, date-only and equivalent timezone instants', () => {
  for (const value of ['2026-02-29', '2026-02-30T12:00:00Z', '2026-02-30t12:00:00z',
    '+002026-02-30T12:00:00Z', '2026-02-30Z', '2026-04-31',
    '02/30/2026', 'February 30, 2026', '30 Feb 2026', '1234', '']) assert.equal(validDate(value), false, value);
  for (const value of ['2028-02-29', '2026-12-01', 'Tue, 01 Dec 2026 12:00:00 GMT']) assert.equal(validDate(value), true, value);
  assert.equal(normalizeTask(task).deadline.valueOf(),
    normalizeTask({ ...task, deadline: '2026-12-01T06:00:00-06:00' }).deadline.valueOf());
});

test('DATA model: defaults, field types, identity and immutable creation-time schema', async () => {
  const u = new User(normalizeUser(user));
  const t = new Task(normalizeTask(task));
  await u.validate();
  await t.validate();
  assert.deepEqual(u.pendingTasks.toObject(), []);
  assert.equal(t.assignedUserName, 'unassigned');
  assert.ok(u.dateCreated instanceof Date);
  assert.ok(t.dateCreated instanceof Date);
  assert.equal(User.schema.path('dateCreated').options.immutable, true);
  assert.equal(Task.schema.path('dateCreated').options.immutable, true);
  assert.ok(User.schema.indexes().some(([keys, options]) => keys.email === 1 && options.unique));
});

test('DATA model: raw invalid values do not silently become valid through casting', async () => {
  for (const change of [{ name: 123 }, { email: {} }, { pendingTasks: id }]) {
    await assert.rejects(new User({ ...normalizeUser(user), ...change }).validate());
  }
  for (const change of [{ name: 123 }, { completed: 'false' }, { description: 99 },
    { deadline: '2026-02-30' }, { assignedUser: 123 }]) {
    await assert.rejects(new Task({ ...normalizeTask(task), ...change }).validate());
  }
});
