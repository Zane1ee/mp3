'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseApiResponse } = require('../../scripts/api-response');

test('DELETE client: successful 204 needs zero bytes and has no synthetic JSON fields', () => {
  assert.deepEqual(parseApiResponse(204, '', 'DELETE'), { status: 204 });
});

test('DELETE client: rejects old 200 JSON, other success statuses and nonempty 204 bodies', () => {
  for (const status of [200, 201, 202]) {
    assert.throws(() => parseApiResponse(status, '{"message":"deleted","data":[]}', 'DELETE'), /204/);
  }
  for (const body of ['{}', '[]', 'null', ' ', '\n']) {
    assert.throws(() => parseApiResponse(204, body, 'DELETE'), /empty response body/);
  }
});

test('DELETE client: 404/500 remain strict JSON; existing GET/POST/PUT responses remain supported', () => {
  for (const [method, status] of [['DELETE', 404], ['DELETE', 500], ['GET', 200], ['POST', 201], ['PUT', 200]]) {
    assert.deepEqual(parseApiResponse(status, '{"message":"Example","data":{}}', method),
      { status, message: 'Example', data: {} });
  }
});

test('DELETE client: empty handling cannot hide malformed JSON or unexpected empty successes elsewhere', () => {
  for (const [method, status, text] of [['GET', 204, ''], ['POST', 204, ''], ['GET', 200, ''],
    ['DELETE', 404, ''], ['DELETE', 500, '{}'], ['GET', 200, 'null'], ['GET', 200, '[]'],
    ['GET', 200, '{"message":1,"data":{}}']]) {
    assert.throws(() => parseApiResponse(status, text, method));
  }
});
