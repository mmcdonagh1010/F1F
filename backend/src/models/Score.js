import mongoose from 'mongoose';

const { Schema } = mongoose;

const ScoreSchema = new Schema({
  league: { type: Schema.Types.ObjectId, ref: 'League', required: false, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  race: { type: Schema.Types.ObjectId, ref: 'Race', required: true, index: true },
  points: { type: Number, default: 0 },
  breakdown: { type: Schema.Types.Mixed },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.Score || mongoose.model('Score', ScoreSchema);
