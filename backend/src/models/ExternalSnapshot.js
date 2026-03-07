import mongoose from 'mongoose';

const { Schema } = mongoose;

const ExternalSnapshotSchema = new Schema({
  snapshot_key: { type: String, required: true, unique: true, index: true },
  snapshot_type: { type: String, required: true, index: true },
  season: { type: Number, index: true },
  entity_id: { type: String, default: null },
  payload: { type: Schema.Types.Mixed, required: true },
  source: { type: String, default: 'jolpica' },
  fetched_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

export default mongoose.models.ExternalSnapshot || mongoose.model('ExternalSnapshot', ExternalSnapshotSchema);