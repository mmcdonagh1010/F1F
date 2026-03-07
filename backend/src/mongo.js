import mongoose from 'mongoose';
import { config } from './config.js';

let cached = global.__mongoose;
if (!cached) {
  cached = global.__mongoose = { conn: null, promise: null };
}

export async function connectMongo() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    // Allow either a full connection string or construct from credentials
    let uri = process.env.MONGODB_URI || config.mongodbUri || '';
    if (!uri) {
      // If running in production, allow building the Atlas URI from username/password
      if (process.env.NODE_ENV === 'production' && process.env.MONGO_USERNAME && process.env.MONGO_PASSWORD) {
        const user = encodeURIComponent(process.env.MONGO_USERNAME);
        const pass = encodeURIComponent(process.env.MONGO_PASSWORD);
        uri = `mongodb+srv://${user}:${pass}@f1-fantasy-league.40bag.mongodb.net/?retryWrites=true&w=majority&appName=f1-fantasy-league`;
      } else if (process.env.MONGO_URI_DEV) {
        uri = process.env.MONGO_URI_DEV;
      }
    }

    if (!uri) throw new Error('MONGODB_URI not configured (set MONGODB_URI or MONGO_USERNAME/MONGO_PASSWORD or MONGO_URI_DEV)');

    cached.promise = mongoose.connect(uri).then((m) => m.connection);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

export function getMongoose() {
  return mongoose;
}
