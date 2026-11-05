'use strict';

const assert = require('node:assert/strict');

// Shared by the API acceptance client and HTTP test clients. A successful
// DELETE has no JSON; all other resource responses retain their JSON contract.
function parseApiResponse(status, text, method) {
  if (method === 'DELETE' && status >= 200 && status < 300) {
    assert.equal(status, 204, 'Successful DELETE must return HTTP 204.');
    assert.equal(text, '', 'HTTP 204 must have an empty response body.');
    return { status };
  }
  assert.notEqual(status, 204, 'Unexpected HTTP 204 for a JSON resource response.');
  let envelope;
  try { envelope = JSON.parse(text); }
  catch { throw new Error(`Expected a JSON resource response; HTTP ${status}.`); }
  assert.ok(envelope && typeof envelope === 'object' && !Array.isArray(envelope));
  assert.deepEqual(Object.keys(envelope).sort(), ['data', 'message']);
  assert.equal(typeof envelope.message, 'string');
  return { status, ...envelope };
}

module.exports = { parseApiResponse };
