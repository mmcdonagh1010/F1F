import { connectMongo } from '../src/mongo.js';
import User from '../src/models/User.js';

(async () => {
  const conn = await connectMongo();
  console.log('mongo host', conn.host, 'name', conn.name);
  const count = await User.countDocuments();
  console.log('user count', count);
})();
