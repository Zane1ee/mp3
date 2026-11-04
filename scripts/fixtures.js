'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const { databaseTarget } = require('../config/environment');
const { isId } = require('../lib/validation');
const User = require('../models/user');
const Task = require('../models/task');

const manifestPath = path.join(__dirname, '..', '.local', 'round1-fixtures.json');

async function createFixtures(runTag = randomUUID()) {
  const users = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const tasks = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const names = { userA: `QA-${runTag}-A`, userB: `QA-${runTag}-B`,
    task1: `QA-${runTag}-01`, task2: `QA-${runTag}-02`, task3: `QA-${runTag}-03` };
  await mongoose.connection.transaction(async (session) => {
    await User.insertMany([
      { _id: users[0], name: names.userA, email: `qa.${runTag}.a@example.com`, pendingTasks: [tasks[1].toString()] },
      { _id: users[1], name: names.userB, email: `qa.${runTag}.b@example.com`, pendingTasks: [] },
    ], { session });
    await Task.insertMany([
      { _id: tasks[0], name: names.task1, deadline: '2026-12-01T12:00:00Z' },
      { _id: tasks[1], name: names.task2, deadline: '2026-12-01T12:00:00Z',
        assignedUser: users[0].toString(), assignedUserName: names.userA },
      { _id: tasks[2], name: names.task3, deadline: '2026-12-01T12:00:00Z', completed: true,
        assignedUser: users[1].toString(), assignedUserName: names.userB },
    ], { session });
  });
  return { version: 1, database: mongoose.connection.name, runTag, names,
    userA: users[0].toString(), userB: users[1].toString(),
    task1: tasks[0].toString(), task2: tasks[1].toString(), task3: tasks[2].toString() };
}

async function cleanFixtures(manifest) {
  const ids = ['userA', 'userB', 'task1', 'task2', 'task3'];
  const extraTaskIds = manifest.extraTaskIds ?? [];
  if (manifest.version !== 1 || manifest.database !== mongoose.connection.name ||
    typeof manifest.runTag !== 'string' || !/^[a-f\d-]+$/i.test(manifest.runTag) ||
    !ids.every((key) => isId(manifest[key])) || !Array.isArray(extraTaskIds) ||
    !extraTaskIds.every(isId)) throw new Error('Invalid or mismatched fixture manifest.');
  const userIds = [manifest.userA, manifest.userB];
  const taskIds = [...new Set([manifest.task1, manifest.task2, manifest.task3, ...extraTaskIds].map((id) => id.toLowerCase()))];
  const name = { $regex: `^QA-${manifest.runTag}-` };
  await mongoose.connection.transaction(async (session) => {
    const tasks = await Task.find({ _id: { $in: taskIds } }).session(session).lean();
    const users = await User.find({ _id: { $in: userIds } }).session(session).lean();
    if ([...tasks, ...users].some((document) => !document.name.startsWith(`QA-${manifest.runTag}-`))) {
      throw new Error('Fixture IDs must still belong to this run tag.');
    }
    if (await Task.exists({ assignedUser: { $in: userIds }, _id: { $nin: taskIds } }).session(session) ||
      await User.exists({ _id: { $nin: userIds }, pendingTasks: { $in: taskIds } }).session(session) ||
      tasks.some((task) => task.assignedUser && !userIds.includes(task.assignedUser)) ||
      users.some((user) => user.pendingTasks.some((id) => !taskIds.includes(id)))) {
      throw new Error('Fixture relationships extend outside the supplied IDs; cleanup refused.');
    }
    await Task.deleteMany({ _id: { $in: taskIds }, name }, { session });
    await User.deleteMany({ _id: { $in: userIds }, name }, { session });
  });
}

function extraIds(args) {
  const ids = [];
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== '--task-id' || !isId(args[i + 1])) throw new Error('Use repeated --task-id VALID_ID for owned created tasks.');
    ids.push(args[i + 1].toLowerCase());
  }
  return [...new Set(ids)];
}

async function main(action, args = []) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const target = databaseTarget(process.env.MONGODB_URI);
  if (!/(?:^|_)dev(?:_|$)/i.test(target.name)) throw new Error('Fixtures require a dedicated *_dev database.');
  if (!['create', 'clean'].includes(action)) throw new Error('Use fixtures:create or fixtures:clean.');
  const extraTaskIds = extraIds(args);
  if (action === 'create' && extraTaskIds.length) throw new Error('Extra task IDs apply only to cleanup.');
  let existing;
  try { existing = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (action === 'create' && existing) throw new Error('Fixtures already exist; clean them before creating another set.');
  if (action === 'clean' && !existing) throw new Error('No fixture manifest exists; no records were deleted.');
  await connectDatabase(target.uri);
  try {
    if (action === 'create') {
      const manifest = await createFixtures();
      try {
        await fs.mkdir(path.dirname(manifestPath), { recursive: true });
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        await cleanFixtures(manifest);
        throw error;
      }
      console.log(JSON.stringify(manifest, null, 2));
      console.log('Use these IDs in the Postman collection. Manifest: .local/round1-fixtures.json');
    } else {
      await cleanFixtures({ ...existing, extraTaskIds });
      await fs.unlink(manifestPath);
      console.log('Cleaned only this manifest\'s fixture IDs.');
    }
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) {
  main(process.argv[2], process.argv.slice(3)).catch(() => {
    console.error('Fixture operation failed. Check database configuration and the local fixture manifest; no credentials are printed.');
    process.exitCode = 1;
  });
}

module.exports = { createFixtures, cleanFixtures, extraIds };
