'use strict';

const mongoose = require('mongoose');
const { databaseTarget } = require('./environment');

async function connectDatabase(uri) {
  databaseTarget(uri);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const User = require('../models/user');
    const Task = require('../models/task');
    await User.init();
    await Task.init();
    await mongoose.connection.db.command({ ping: 1 });
  } catch {
    await mongoose.disconnect();
    throw new Error('Database connection or index setup failed. Check the private environment configuration.');
  }
}

module.exports = { connectDatabase };
