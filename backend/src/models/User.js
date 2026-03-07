import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['player', 'admin'], default: 'player' },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.User || mongoose.model('User', UserSchema);
