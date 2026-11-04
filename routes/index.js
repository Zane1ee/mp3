'use strict';

const express = require('express');
const homeRoutes = require('./home');
const resourceRoutes = require('./resources');
const taskWrites = require('./task-writes');
const userWrites = require('./user-writes');
const deletions = require('./deletions');

module.exports = function mountRoutes(app, models, ready, mutations) {
  const router = express.Router();
  homeRoutes(router, ready);
  resourceRoutes(router, models.User, 'users');
  resourceRoutes(router, models.Task, 'tasks');
  taskWrites(router, mutations);
  userWrites(router, mutations);
  deletions(router, mutations);
  app.use('/api', router);
};
