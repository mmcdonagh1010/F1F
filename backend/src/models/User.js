import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['player', 'admin'], default: 'player' },
  email_verified_at: { type: Date },
  email_verification_token_hash: { type: String },
  email_verification_sent_at: { type: Date },
  password_reset_token_hash: { type: String },
  password_reset_expires_at: { type: Date },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.User || mongoose.model('User', UserSchema);
