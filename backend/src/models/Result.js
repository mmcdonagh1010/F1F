import mongoose from 'mongoose';

const { Schema } = mongoose;

const ResultSchema = new Schema({
  race: { type: Schema.Types.ObjectId, ref: 'Race', required: true },
  category: { type: String },
  value_text: { type: String },
  value_number: { type: Number },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.Result || mongoose.model('Result', ResultSchema);
