'use strict';

const mongoose = require('mongoose');
const { isId, emailPattern } = require('../lib/validation');

function stringField(path, extra = {}) {
  return {
    type: String,
    cast: false,
    set(value) {
      if (value !== undefined && typeof value !== 'string') throw new mongoose.Error.CastError('String', value, path);
      return value;
    },
    ...extra,
  };
}

const userSchema = new mongoose.Schema({
  name: stringField('name', { required: true, trim: true }),
  email: stringField('email', { required: true, trim: true, match: emailPattern, unique: true }),
  pendingTasks: {
    type: [String],
    castNonArrays: false,
    default: [],
    validate: { validator: (ids) => ids.every(isId) && new Set(ids).size === ids.length,
      message: 'pendingTasks must contain unique valid IDs' },
  },
  dateCreated: { type: Date, default: Date.now, immutable: true },
}, { bufferCommands: false, strictQuery: false });

module.exports = mongoose.model('User', userSchema);
