'use strict';

const path = require('node:path');
const { once } = require('node:events');
const mongoose = require('mongoose');
const createApp = require('./app');
const { connectDatabase } = require('./config/database');
const { applicationPort } = require('./config/environment');

async function start(environment = process.env) {
  const port = applicationPort(environment.PORT);
  await connectDatabase(environment.MONGODB_URI);
  const server = createApp().listen(port, '0.0.0.0');
  try {
    await once(server, 'listening');
  } catch {
    await mongoose.disconnect();
    throw new Error('HTTP server could not start. Check the configured port.');
  }
  console.log(`Server ready on port ${server.address().port}`);
  return server;
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
  start().then((server) => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        server.close(() => mongoose.disconnect().then(() => process.exit(0)));
      });
    }
  }).catch((error) => {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { start };
