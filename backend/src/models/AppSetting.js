import mongoose from 'mongoose';

const { Schema } = mongoose;

const AppSettingSchema = new Schema({
  setting_key: { type: String, required: true, unique: true, index: true },
  setting_value: { type: String },
  updated_at: { type: Date, default: Date.now }
});

export default mongoose.models.AppSetting || mongoose.model('AppSetting', AppSettingSchema);
