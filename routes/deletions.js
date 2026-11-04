'use strict';

const { respond } = require('../lib/http');

module.exports = function deletions(router, mutations) {
  for (const [resource, method, label] of [['users', 'deleteUser', 'User'], ['tasks', 'deleteTask', 'Task']]) {
    router.delete(`/${resource}/:id`, async (req, res) => {
      const data = await mutations[method](req.params.id);
      return respond(res, 200, `${label} deleted`, data);
    });
  }
};
