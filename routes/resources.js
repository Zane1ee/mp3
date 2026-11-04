'use strict';

const { ApiError, respond } = require('../lib/http');
const { isId } = require('../lib/validation');
const { projection, collectionQuery, buildFind } = require('../lib/query');

function resourceRoutes(router, model, resource) {
  const label = resource === 'users' ? 'User' : 'Task';
  router.get(`/${resource}`, async (req, res) => {
    const options = collectionQuery(req.query, resource);
    const data = options.count
      ? await model.countDocuments(options.where)
      : await buildFind(model, options);
    return respond(res, 200, 'OK', data);
  });

  router.get(`/${resource}/:id`, async (req, res) => {
    const id = req.params.id;
    if (!isId(id) || !await model.exists({ _id: id })) throw new ApiError(404, `${label} not found`);
    const select = projection(req.query);
    let query = model.findById(id);
    if (select) query = query.select(select);
    const data = await query;
    if (!data) throw new ApiError(404, `${label} not found`);
    return respond(res, 200, 'OK', data);
  });
}

module.exports = resourceRoutes;
