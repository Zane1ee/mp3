'use strict';

const mongoose = require('mongoose');
const { isId, validDate } = require('../lib/validation');

const stringField = (path, extra = {}) => ({
  type: String,
  cast: false,
  set(value) {
    if (value !== undefined && typeof value !== 'string') throw new mongoose.Error.CastError('String', value, path);
    return value;
  },
  ...extra,
});

const taskSchema = new mongoose.Schema({
  name: stringField('name', { required: true, trim: true }),
  description: stringField('description', { default: '' }),
  deadline: {
    type: Date,
    required: true,
    set(value) {
      if (value === undefined) return value;
      if (value instanceof Date && Number.isFinite(value.valueOf())) return value;
      if (validDate(value)) return new Date(value);
      throw new mongoose.Error.CastError('Date', value, 'deadline');
    },
  },
  completed: {
    type: Boolean,
    default: false,
    set(value) {
      if (value !== undefined && typeof value !== 'boolean') throw new mongoose.Error.CastError('Boolean', value, 'completed');
      return value;
    },
  },
  assignedUser: stringField('assignedUser', { default: '', validate: (id) => id === '' || isId(id) }),
  assignedUserName: stringField('assignedUserName', { default: 'unassigned' }),
  dateCreated: { type: Date, default: Date.now, immutable: true },
}, { bufferCommands: false, strictQuery: false });

module.exports = mongoose.model('Task', taskSchema);
