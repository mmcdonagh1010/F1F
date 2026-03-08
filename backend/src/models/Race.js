import mongoose from 'mongoose';

const { Schema } = mongoose;

const RaceSchema = new Schema({
  league: { type: Schema.Types.ObjectId, ref: 'League', required: false },
  leagues: [{ type: Schema.Types.ObjectId, ref: 'League', index: true }],
  name: { type: String, required: true },
  circuit_name: { type: String },
  external_round: { type: Number },
  race_date: { type: Date },
  manual_deadline_at: { type: Date },
  deadline_at: { type: Date },
  status: { type: String, enum: ['scheduled','completed','cancelled'], default: 'scheduled' },
  is_visible: { type: Boolean, default: true },
  tie_breaker_value: { type: Schema.Types.Mixed },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.Race || mongoose.model('Race', RaceSchema);
