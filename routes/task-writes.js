'use strict';

const { respond } = require('../lib/http');

module.exports = function taskWrites(router, mutations) {
  router.post('/tasks', async (req, res) => {
    const data = await mutations.createTask(req.body, Boolean(req.is('application/x-www-form-urlencoded')));
    return respond(res, 201, 'Task created', data);
  });
  router.put('/tasks/:id', async (req, res) => {
    const data = await mutations.replaceTask(req.params.id, req.body, Boolean(req.is('application/x-www-form-urlencoded')));
    return respond(res, 200, 'Task updated', data);
  });
};
