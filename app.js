'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { ApiError, errorHandler } = require('./lib/http');
const mountRoutes = require('./routes');
const { createRelationshipService } = require('./lib/relationships');

function createApp(options = {}) {
  const models = options.models ?? { User: require('./models/user'), Task: require('./models/task') };
  const ready = options.ready ?? (() => mongoose.connection.readyState === 1);
  const mutations = options.mutations ?? createRelationshipService({ models });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    res.set('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  mountRoutes(app, models, ready, mutations);
  app.use((req, res, next) => next(new ApiError(404, 'Endpoint not found')));
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
