import mongoose from 'mongoose';

const { Schema } = mongoose;

const PickCategorySchema = new Schema({
  race: { type: Schema.Types.ObjectId, ref: 'Race', required: true, index: true },
  name: { type: String, required: true },
  display_order: { type: Number },
  is_position_based: { type: Boolean, default: false },
  metadata: { type: Schema.Types.Mixed, default: {} },
  exact_points: { type: Number, default: 0 },
  partial_points: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.PickCategory || mongoose.model('PickCategory', PickCategorySchema);
