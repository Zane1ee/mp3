'use strict';

const { respond } = require('../lib/http');

module.exports = function userWrites(router, mutations) {
  router.post('/users', async (req, res) => {
    const data = await mutations.createUser(req.body, Boolean(req.is('application/x-www-form-urlencoded')));
    return respond(res, 201, 'User created', data);
  });
  router.put('/users/:id', async (req, res) => {
    const data = await mutations.replaceUser(req.params.id, req.body, Boolean(req.is('application/x-www-form-urlencoded')));
    return respond(res, 200, 'User updated', data);
  });
};
