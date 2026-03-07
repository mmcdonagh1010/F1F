import { connectMongo, getMongoose } from './mongo.js';

// SQL shim removed — project is MongoDB/Mongoose native.
// Export a `connect` helper (wraps `connectMongo`) and `getMongoose`
// so callers can obtain the active Mongoose connection if needed.

export async function connect() {
  return connectMongo();
}

export function getDbMongoose() {
  return getMongoose();
}

export default connect;
