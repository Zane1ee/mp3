'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseTarget, isolatedTestTarget, applicationPort } = require('../../config/environment');

test('ENV: requires explicit non-placeholder application database without exposing URI', () => {
  const secret = 'mongodb+srv://owner:private-password@cluster.example.com/';
  for (const uri of [undefined, '', 'https://example.com/dev', secret,
    'mongodb://127.0.0.1/admin', 'mongodb://127.0.0.1/local',
    'mongodb+srv://<username>:<password>@cluster.example.com/cs409_mp3_dev']) {
    assert.throws(() => databaseTarget(uri), (error) => !error.message.includes('private-password'));
  }
  assert.equal(databaseTarget('mongodb+srv://cluster.example.com/cs409_mp3_dev').name, 'cs409_mp3_dev');
});

test('ENV: integration database must be explicit, dedicated and separate', () => {
  const app = 'mongodb://127.0.0.1:27017/cs409_mp3_dev';
  assert.throws(() => isolatedTestTarget({ MONGODB_URI: app }));
  assert.throws(() => isolatedTestTarget({ MONGODB_URI: app, TEST_MONGODB_URI: app }));
  assert.throws(() => isolatedTestTarget({ MONGODB_URI: app,
    TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/cs409_mp3_prod' }));
  assert.equal(isolatedTestTarget({ MONGODB_URI: app,
    TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/cs409_mp3_test' }).name, 'cs409_mp3_test');
});

test('ENV: port defaults, ephemeral testing and invalid values', () => {
  assert.equal(applicationPort(undefined), 3000);
  assert.equal(applicationPort('0'), 0);
  assert.equal(applicationPort('10000'), 10000);
  for (const value of ['-1', '3.5', '65536', 'abc', ' 3000 ', '1e3']) {
    assert.throws(() => applicationPort(value));
  }
});
