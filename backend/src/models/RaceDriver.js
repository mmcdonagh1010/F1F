import mongoose from 'mongoose';

const { Schema } = mongoose;

const RaceDriverSchema = new Schema({
  race: { type: Schema.Types.ObjectId, ref: 'Race', required: true, index: true },
  driver_name: { type: String, required: true },
  team_name: { type: String },
  display_order: { type: Number },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.RaceDriver || mongoose.model('RaceDriver', RaceDriverSchema);
