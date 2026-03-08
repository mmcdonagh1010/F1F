import mongoose from 'mongoose';

const { Schema } = mongoose;

const PickSchema = new Schema({
  league: { type: Schema.Types.ObjectId, ref: 'League', required: false, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  race: { type: Schema.Types.ObjectId, ref: 'Race', required: true, index: true },
  category: { type: Schema.Types.ObjectId, ref: 'PickCategory' },
  value_text: { type: String },
  value_number: { type: Number },
  status: { type: String, enum: ['draft', 'submitted'], default: 'draft', index: true },
  submitted_at: { type: Date },
  updated_at: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.Pick || mongoose.model('Pick', PickSchema);
