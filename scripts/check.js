'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24 LTS.');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
assert.equal(lock.packages[''].engines.node, pkg.engines.node);

const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (file.endsWith('.js')) files.push(file);
  }
}
for (const directory of ['config', 'lib', 'models', 'routes', 'scripts', 'tests']) visit(path.join(root, directory));
for (const name of ['app.js', 'server.js', 'submit.js']) files.push(path.join(root, name));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `Syntax check failed: ${path.relative(root, file)}\n${result.stderr}`);
}

// JSON is a YAML 1.2 subset. No extra parser dependency is needed for this file.
const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'openapi.yaml')));
assert.equal(spec.openapi, '3.1.0');
assert.equal(spec.servers[0].url, 'http://localhost:3000/api');
const operationIds = [];
for (const [route, operations] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(operations)) {
    if (!['get', 'post', 'put', 'delete'].includes(method)) continue;
    assert.ok(operation.responses);
    if (route.includes('{id}')) assert.ok(operation.parameters.some((p) => p.$ref.endsWith('/id')));
    if (operation.operationId.startsWith('HTTP-')) operationIds.push(operation.operationId);
    if (['post', 'put'].includes(method)) assert.ok(operation.requestBody.required);
  }
}
assert.deepEqual(operationIds.sort(), Array.from({ length: 10 }, (_, i) => `HTTP-${String(i + 1).padStart(2, '0')}`));
const implemented = Object.values(spec.paths).flatMap((operations) => Object.values(operations))
  .filter((operation) => operation['x-implementation-status'] === 'implemented' && operation.operationId?.startsWith('HTTP-'))
  .map((operation) => operation.operationId).sort();
assert.deepEqual(implemented, operationIds.sort());
for (const route of ['/users/{id}', '/tasks/{id}']) {
  const responses = spec.paths[route].delete.responses;
  assert.ok(responses['204'], `${route} DELETE must document HTTP 204.`);
  assert.equal(responses['204'].content, undefined, 'DELETE 204 must not declare JSON content.');
  assert.equal(responses['200'], undefined, 'The provisional DELETE 200 contract is superseded.');
  assert.ok(responses['404'].content['application/json']);
  assert.ok(responses['500'].content['application/json']);
}
function references(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) {
    assert.ok(value.$ref.startsWith('#/'));
    const target = value.$ref.slice(2).split('/').reduce((current, key) => current?.[key], spec);
    assert.ok(target, `Unresolved reference: ${value.$ref}`);
  }
  for (const child of Object.values(value)) references(child);
}
references(spec);
assert.deepEqual(spec.components.schemas.UserInput.required, ['name', 'email']);
assert.deepEqual(spec.components.schemas.TaskInput.required, ['name', 'deadline']);
assert.equal(spec.components.schemas.UserInput.properties.email.pattern, require('../lib/validation').emailPattern.source);
assert.deepEqual(spec.components.schemas.UserInput.properties.pendingTasks.default, []);
assert.equal(spec.components.schemas.TaskInput.properties.completed.default, false);
assert.equal(spec.components.schemas.TaskInput.properties.description.default, '');
const collection = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'mp3.postman_collection.json')));
assert.ok(collection.item.length >= 10);
let scriptCount = 0;
for (const item of collection.item) {
  assert.ok(['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'].includes(item.request.method));
  if (['POST', 'PUT'].includes(item.request.method)) {
    assert.ok(['users', 'tasks'].includes(item.request.url.path[0]), 'Writes must target a resource path.');
  }
  for (const event of item.event ?? []) {
    new vm.Script(event.script.exec.join('\n'));
    scriptCount++;
  }
}
assert.equal(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(), '24.20.0');
assert.equal(fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim(), '24.20.0');
console.log(`Checked ${files.length} JavaScript files; ten target/ten implemented operations, local OpenAPI references, schemas and ${scriptCount} scripts for ${collection.item.length} Postman requests.`);
console.log('This is syntax/contract validation, not an Atlas integration result.');
