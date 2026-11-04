'use strict';

const mongoose = require('mongoose');
const { ApiError } = require('./http');
const { isId, normalizeUser, normalizeTask } = require('./validation');

const transactionOptions = {
  readPreference: 'primary',
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  timeoutMS: 15000,
  maxCommitTimeMS: 5000,
};

function versionFilter(document) {
  return { _id: document._id, __v: document.__v ?? { $exists: false } };
}

function conflict() {
  const error = new mongoose.mongo.MongoServerError({ message: 'Concurrent relationship update', code: 112 });
  error.addErrorLabel('TransientTransactionError');
  return error;
}

// Hooks are constructor-only test dependencies. No route, body or environment
// variable enables them. Each callback attempt builds fresh state from MongoDB.
function createRelationshipService({
  connection = mongoose.connection,
  models = { User: require('../models/user'), Task: require('../models/task') },
  beforeWrite,
  afterWrite,
} = {}) {
  const { User, Task } = models;

  function run(work) {
    return connection.transaction(async (session) => {
      const users = new Map();
      async function user(id, status = 404) {
        if (!users.has(id)) {
          const document = await User.findById(id).session(session).lean();
          if (!document) throw new ApiError(status, status === 404 ? 'User not found' : 'Stored relationship is unavailable');
          users.set(id, document);
        }
        return users.get(id);
      }
      async function task(id) {
        if (!isId(id)) throw new ApiError(404, 'Task not found');
        const document = await Task.findById(id).session(session).lean();
        if (!document) throw new ApiError(404, 'Task not found');
        return document;
      }
      async function notify(hook, model, id) {
        if (hook) await hook({ model: model.modelName, id: String(id), session });
      }
      async function update(model, document, fields) {
        await notify(beforeWrite, model, document._id);
        const result = await model.findOneAndUpdate(versionFilter(document), {
          $set: fields, $inc: { __v: 1 },
        }, { session, runValidators: true, returnDocument: 'after' }).lean();
        if (!result) throw conflict();
        await notify(afterWrite, model, document._id);
        return result;
      }
      async function insert(model, fields) {
        const document = new model(fields);
        await notify(beforeWrite, model, document._id);
        await document.save({ session });
        await notify(afterWrite, model, document._id);
        return document.toObject();
      }
      async function remove(model, document) {
        await notify(beforeWrite, model, document._id);
        const result = await model.deleteOne(versionFilter(document), { session });
        if (result.deletedCount !== 1) throw conflict();
        await notify(afterWrite, model, document._id);
      }
      async function persistUsers(changes) {
        for (const id of [...changes.keys()].sort()) {
          // $inc is a real write, even when a completed assignment changes no
          // pending IDs. It conflicts with concurrent user rename/deletion.
          await update(User, await user(id, 500), changes.get(id));
        }
      }
      return work({ session, user, task, update, insert, remove, persistUsers });
    }, transactionOptions);
  }

  async function writeTask(id, body, form = false) {
    if (id !== undefined && !isId(id)) throw new ApiError(404, 'Task not found');
    const createdId = id === undefined ? new mongoose.Types.ObjectId() : undefined;
    return run(async (tx) => {
      const previous = id === undefined ? undefined : await tx.task(id);
      const fields = normalizeTask(body, form);
      let owner;
      if (fields.assignedUser) {
        owner = await tx.user(fields.assignedUser);
        if (fields.assignedUserName !== undefined && fields.assignedUserName !== owner.name) {
          throw new ApiError(400, 'assignedUserName must match the assigned user');
        }
        fields.assignedUserName = owner.name;
      }
      const taskId = String(previous?._id ?? createdId);
      const changes = new Map();
      if (previous?.assignedUser) {
        const former = await tx.user(previous.assignedUser, 500);
        changes.set(previous.assignedUser, { pendingTasks: former.pendingTasks.filter((value) => value !== taskId) });
      }
      if (owner) {
        const pendingTasks = owner.pendingTasks.filter((value) => value !== taskId);
        if (!fields.completed) pendingTasks.push(taskId);
        changes.set(fields.assignedUser, { pendingTasks });
      }
      await tx.persistUsers(changes);
      return previous
        ? tx.update(Task, previous, fields)
        : tx.insert(Task, { ...fields, _id: createdId });
    });
  }

  // Both resource directions use the same transaction and version guards.
  async function writeUser(id, body, form = false) {
    if (id !== undefined && !isId(id)) throw new ApiError(404, 'User not found');
    const createdId = id === undefined ? new mongoose.Types.ObjectId() : undefined;
    return run(async (tx) => {
      const previous = id === undefined ? undefined : await tx.user(id.toLowerCase());
      const fields = normalizeUser(body, form);
      const userId = String(previous?._id ?? createdId);
      if (await User.exists({ email: fields.email, _id: { $ne: userId } }).session(tx.session)) {
        throw new ApiError(400, 'Email is already in use');
      }
      const requested = await Task.find({ _id: { $in: fields.pendingTasks } }).session(tx.session).lean();
      if (requested.length !== fields.pendingTasks.length) throw new ApiError(404, 'Task not found');
      if (requested.some((document) => document.completed)) throw new ApiError(400, 'pendingTasks cannot contain completed tasks');
      const assigned = previous
        ? await Task.find({ assignedUser: userId }).session(tx.session).lean() : [];
      const desired = new Set(fields.pendingTasks);
      const tasks = new Map(assigned.map((document) => [String(document._id), document]));
      const changes = new Map();
      for (const document of requested) {
        const taskId = String(document._id);
        tasks.set(taskId, document);
        if (document.assignedUser && document.assignedUser !== userId) {
          const former = await tx.user(document.assignedUser, 500);
          const pendingTasks = (changes.get(document.assignedUser)?.pendingTasks ?? former.pendingTasks)
            .filter((value) => value !== taskId);
          changes.set(document.assignedUser, { pendingTasks });
        }
      }
      await tx.persistUsers(changes);
      const result = previous
        ? await tx.update(User, previous, fields)
        : await tx.insert(User, { ...fields, _id: createdId });
      for (const taskId of [...tasks.keys()].sort()) {
        const document = tasks.get(taskId);
        const retain = document.completed || desired.has(taskId);
        await tx.update(Task, document, {
          assignedUser: retain ? userId : '',
          assignedUserName: retain ? fields.name : 'unassigned',
        });
      }
      return result;
    });
  }

  return {
    createTask: (body, form) => writeTask(undefined, body, form),
    replaceTask: (id, body, form) => writeTask(id, body, form),
    createUser: (body, form) => writeUser(undefined, body, form),
    replaceUser: (id, body, form) => writeUser(id, body, form),
    deleteTask: (id) => run(async (tx) => {
      const document = await tx.task(id);
      if (document.assignedUser) {
        const owner = await tx.user(document.assignedUser, 500);
        await tx.persistUsers(new Map([[document.assignedUser,
          { pendingTasks: owner.pendingTasks.filter((value) => value !== String(document._id)) }]]));
      }
      await tx.remove(Task, document);
      return [];
    }),
    deleteUser: (id) => {
      if (!isId(id)) throw new ApiError(404, 'User not found');
      return run(async (tx) => {
        const document = await tx.user(id.toLowerCase());
        const tasks = await Task.find({ assignedUser: String(document._id) }).sort({ _id: 1 }).session(tx.session).lean();
        for (const task of tasks) await tx.update(Task, task, { assignedUser: '', assignedUserName: 'unassigned' });
        await tx.remove(User, document);
        return [];
      });
    },
  };
}

module.exports = { createRelationshipService };
