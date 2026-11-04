'use strict';

const { ApiError } = require('./http');
const { isObject } = require('./validation');

function jsonValue(query, key) {
  if (!Object.hasOwn(query, key)) return undefined;
  if (typeof query[key] !== 'string') throw new ApiError(400, `${key} must be a single JSON value`);
  try { return JSON.parse(query[key]); } catch { throw new ApiError(400, `${key} must contain valid JSON`); }
}

function objectValue(query, key) {
  const value = jsonValue(query, key);
  if (value !== undefined && !isObject(value)) throw new ApiError(400, `${key} must be a JSON object`);
  return value;
}

function fieldPaths(map, key) {
  if (!map) return;
  for (const path of Object.keys(map)) {
    const parts = path.split('.');
    if (path.includes('\0') || parts.some((part) => part === '')) {
      throw new ApiError(400, `${key} field paths must contain nonempty components`);
    }
    if (key === 'select' && parts.some((part, index) => part.startsWith('$') &&
      !['$id', '$ref', '$db'].includes(part) && !(part === '$' && index > 0 && index === parts.length - 1))) {
      throw new ApiError(400, 'select contains an invalid reserved field path');
    }
  }
}

function projection(query) {
  const select = objectValue(query, 'select');
  if (select === undefined) return select;
  fieldPaths(select, 'select');
  const paths = new Set(Object.keys(select));
  if ([...paths].filter((path) => path.endsWith('.$')).length > 1) {
    throw new ApiError(400, 'select can contain only one positional field');
  }
  for (const path of paths) {
    if (path.endsWith('.$') && select[path] !== 1) throw new ApiError(400, 'Positional select must include a field');
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) {
      if (paths.has(parts.slice(0, i).join('.'))) {
        throw new ApiError(400, 'select cannot contain both a field and its child path');
      }
    }
  }
  let inclusion = false;
  let exclusion = false;
  for (const [key, value] of Object.entries(select)) {
    if (value !== 0 && value !== 1) throw new ApiError(400, 'select values must be 1 or 0');
    if (key === '_id') continue;
    inclusion ||= value === 1;
    exclusion ||= value === 0;
  }
  if (inclusion && exclusion) throw new ApiError(400, 'select cannot mix included and excluded fields');
  return select;
}

function integerValue(query, key, fallback) {
  const value = jsonValue(query, key);
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, `${key} must be a nonnegative integer`);
  return value;
}

function collectionQuery(query, resource) {
  const where = objectValue(query, 'where') ?? {};
  const sort = objectValue(query, 'sort');
  fieldPaths(sort, 'sort');
  if (sort && Object.values(sort).some((value) => value !== 1 && value !== -1)) {
    throw new ApiError(400, 'sort values must be 1 or -1');
  }
  const select = projection(query);
  const skip = integerValue(query, 'skip', 0);
  const limit = integerValue(query, 'limit', resource === 'tasks' ? 100 : 0);
  const parsedCount = jsonValue(query, 'count');
  const count = parsedCount === undefined ? false : parsedCount;
  if (typeof count !== 'boolean') throw new ApiError(400, 'count must be true or false');
  return { where, sort, select, skip, limit, count };
}

function buildFind(model, options) {
  let query = model.find(options.where);
  if (options.sort) query = query.sort(options.sort);
  if (options.select) query = query.select(options.select);
  if (options.skip) query = query.skip(options.skip);
  if (options.limit) query = query.limit(options.limit);
  return query;
}

module.exports = { projection, collectionQuery, buildFind };
