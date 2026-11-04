'use strict';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function respond(res, status, message, data) {
  return res.status(status).json({ message, data });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) return respond(res, error.status, error.message, {});
  if (['entity.parse.failed', 'entity.too.large', 'encoding.unsupported',
    'charset.unsupported', 'request.aborted'].includes(error.type)) {
    return respond(res, 400, 'Invalid request body', {});
  }
  if (error.code === 11000) return respond(res, 400, 'Email is already in use', {});
  if (['CastError', 'ValidationError', 'StrictModeError'].includes(error.name)) {
    return respond(res, 400, 'Invalid field or query value', {});
  }
  if (error.name === 'MongoServerError' && [2, 9, 14].includes(error.code)) {
    return respond(res, 400, 'Invalid query', {});
  }
  return respond(res, 500, 'An unexpected server error occurred', {});
}

module.exports = { ApiError, respond, errorHandler };
