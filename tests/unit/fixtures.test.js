'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extraIds } = require('../../scripts/fixtures');

test('ENV fixtures: cleanup accepts only explicit canonical task IDs and refuses malformed arguments', () => {
  const id = 'abcdef123456789012345678';
  assert.deepEqual(extraIds([]), []);
  assert.deepEqual(extraIds(['--task-id', id.toUpperCase(), '--task-id', id]), [id]);
  for (const args of [['--task-id'], ['--task-id', 'bad'], ['--all'], ['--task-id', id, 'extra'], ['--unknown', id]]) {
    assert.throws(() => extraIds(args), /--task-id VALID_ID/);
  }
});
