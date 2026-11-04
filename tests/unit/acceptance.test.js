'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { originTarget } = require('../../scripts/acceptance');

test('API acceptance rejects path/credential/remote plaintext origins before any request', () => {
  for (const input of ['not-a-url', 'https://example.com/api', 'https://example.com/?x=y',
    'https://example.com/#fragment', 'https://user:password@example.com', 'http://example.com',
    'mongodb+srv://user:password@example.com/db', 'https://YOUR-APP-NAME.onrender.com']) {
    assert.throws(() => originTarget(input));
  }
});

test('API acceptance allows explicit HTTPS and loopback development origins', () => {
  for (const input of ['https://example.com', 'https://example.com/', 'http://127.0.0.1:3000', 'http://localhost:3000', 'http://[::1]:3000']) {
    assert.equal(originTarget(input), new URL(input).origin);
  }
});
