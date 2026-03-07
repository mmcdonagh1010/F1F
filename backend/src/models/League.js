import mongoose from 'mongoose';

const { Schema } = mongoose;

const LeagueSchema = new Schema({
  name: { type: String, required: true },
  invite_code: { type: String, required: true, index: true },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.League || mongoose.model('League', LeagueSchema);
