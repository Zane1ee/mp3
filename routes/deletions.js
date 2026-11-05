'use strict';

module.exports = function deletions(router, mutations) {
  for (const [resource, method] of [['users', 'deleteUser'], ['tasks', 'deleteTask']]) {
    router.delete(`/${resource}/:id`, async (req, res) => {
      await mutations[method](req.params.id);
      return res.status(204).end();
    });
  }
};
