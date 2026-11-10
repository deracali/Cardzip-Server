import mongoose from 'mongoose';

const featureSettingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  esimEnabled: { type: Boolean, default: true },
  vtpassBillsEnabled: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('FeatureSettings', featureSettingsSchema);
