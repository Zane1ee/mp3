'use strict';

const { ApiError } = require('./http');
const objectIdPattern = /^[a-f\d]{24}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const own = (value, key) => Object.hasOwn(value, key);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value) {
  return typeof value === 'string' && objectIdPattern.test(value);
}

function bodyObject(body) {
  if (!isObject(body)) throw new ApiError(400, 'Request body must be an object');
}

function requiredString(body, key) {
  if (typeof body[key] !== 'string' || !body[key].trim()) {
    throw new ApiError(400, `${key} must be a nonempty string`);
  }
  return body[key].trim();
}

function optionalString(body, key, fallback) {
  if (!own(body, key)) return fallback;
  if (typeof body[key] !== 'string') throw new ApiError(400, `${key} must be a string`);
  return body[key];
}

function calendarParts(value) {
  let match = value.match(/^([+-]?\d{4,6})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return match.slice(1).map(Number);
  match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) return [Number(match[3]), Number(match[1]), Number(match[2])];
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  match = value.match(/(?:^|\s)(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:$|\s)/);
  if (match && months.includes(match[2].slice(0, 3).toLowerCase())) {
    return [Number(match[3]), months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1, Number(match[1])];
  }
  match = value.match(/(?:^|\s)([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(\d{4})(?:$|\s)/);
  if (match && months.includes(match[1].slice(0, 3).toLowerCase())) {
    return [Number(match[3]), months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, Number(match[2])];
  }
  return null;
}

function validDate(value) {
  if (typeof value !== 'string' || !value.trim() || /^\d+$/.test(value.trim())) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return false;
  const parts = calendarParts(value.trim());
  if (parts) {
    const [year, month, day] = parts;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) return false;
  }
  return true;
}

function normalizeUser(body, form = false) {
  bodyObject(body);
  const name = requiredString(body, 'name');
  const email = requiredString(body, 'email');
  if (!emailPattern.test(email)) throw new ApiError(400, 'email must be a valid address');
  let ids = own(body, 'pendingTasks') ? body.pendingTasks : [];
  if (form && typeof ids === 'string') {
    try { ids = JSON.parse(ids); } catch { throw new ApiError(400, 'pendingTasks must be an array of IDs'); }
  }
  if (!Array.isArray(ids) || !ids.every(isId)) {
    throw new ApiError(400, 'pendingTasks must be an array of valid IDs');
  }
  return { name, email, pendingTasks: [...new Set(ids.map((id) => id.toLowerCase()))] };
}

function normalizeTask(body, form = false) {
  bodyObject(body);
  const name = requiredString(body, 'name');
  if (!validDate(body.deadline)) throw new ApiError(400, 'deadline must be a valid date');
  const description = optionalString(body, 'description', '');
  let completed = own(body, 'completed') ? body.completed : false;
  if (form && ['true', 'false'].includes(completed)) completed = completed === 'true';
  if (typeof completed !== 'boolean') throw new ApiError(400, 'completed must be a Boolean');
  const assignedUser = optionalString(body, 'assignedUser', '');
  if (assignedUser !== '' && !isId(assignedUser)) throw new ApiError(400, 'assignedUser must be a valid ID');
  const suppliedName = optionalString(body, 'assignedUserName', undefined);
  return {
    name, description, deadline: new Date(body.deadline), completed,
    assignedUser: assignedUser.toLowerCase(),
    assignedUserName: assignedUser === '' ? 'unassigned' : suppliedName,
  };
}

module.exports = { isObject, isId, emailPattern, validDate, normalizeUser, normalizeTask };
