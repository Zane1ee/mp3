'use strict';

const { respond } = require('../lib/http');

module.exports = function homeRoutes(router, ready) {
  router.get('/', (req, res) => respond(res, 200, 'OK', { service: 'cs409-mp3-api' }));
  router.get('/health', (req, res) => {
    const connected = ready();
    return respond(res, connected ? 200 : 503,
      connected ? 'Ready' : 'Database unavailable', { ready: connected });
  });
  return router;
};
