import mongoose from 'mongoose';

const { Schema } = mongoose;

const LeagueMemberSchema = new Schema({
  league: { type: Schema.Types.ObjectId, ref: 'League', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  joined_at: { type: Date, default: Date.now }
});

LeagueMemberSchema.index({ league: 1, user: 1 }, { unique: true });

export default mongoose.models.LeagueMember || mongoose.model('LeagueMember', LeagueMemberSchema);
