'use strict';

function databaseTarget(uri, label = 'MONGODB_URI') {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error(`${label} must be configured in your local environment.`);
  }
  let url;
  try {
    url = new URL(uri);
  } catch {
    throw new Error(`${label} must contain a valid MongoDB connection URI.`);
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(url.protocol)) {
    throw new Error(`${label} must use mongodb:// or mongodb+srv://.`);
  }
  let name;
  try {
    name = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(`${label} must specify a valid database name.`);
  }
  if (!name || /[/\\\s"$.*<>:|?]/.test(name) || ['admin', 'config', 'local'].includes(name)) {
    throw new Error(`${label} must explicitly name an application database.`);
  }
  if (uri.includes('<') || uri.includes('>')) {
    throw new Error(`${label} still contains template placeholders.`);
  }
  return { uri, name, host: url.host.toLowerCase() };
}

function isolatedTestTarget(environment = process.env) {
  const app = databaseTarget(environment.MONGODB_URI);
  const test = databaseTarget(environment.TEST_MONGODB_URI, 'TEST_MONGODB_URI');
  if (!/(?:^|_)test(?:_|$)/i.test(test.name)) {
    throw new Error('TEST_MONGODB_URI must name a dedicated *_test database.');
  }
  if (app.name === test.name) {
    throw new Error('Development and test database names must be different.');
  }
  return test;
}

function applicationPort(value = process.env.PORT) {
  if (value === undefined || value === '') return 3000;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return port;
}

module.exports = { databaseTarget, isolatedTestTarget, applicationPort };
