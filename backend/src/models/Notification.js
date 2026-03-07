import mongoose from 'mongoose';

const { Schema } = mongoose;

const NotificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  race: { type: Schema.Types.ObjectId, ref: 'Race' },
  type: { type: String, required: true },
  payload: { type: Schema.Types.Mixed },
  title: { type: String },
  body: { type: String },
  is_read: { type: Boolean, default: false },
  metadata: { type: Schema.Types.Mixed },
  created_at: { type: Date, default: Date.now }
});

export default mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
