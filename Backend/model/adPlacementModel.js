import mongoose from 'mongoose';

const adDurationPriceSchema = new mongoose.Schema({
  months: { type: Number, enum: [1, 12], required: true },
  price: { type: Number, required: true, min: 0 },
}, { _id: false });

const adPlacementSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  platform: { type: String, enum: ['website', 'app'], required: true, index: true },
  location: { type: String, required: true, trim: true, maxlength: 160 },
  format: { type: String, enum: ['wide', 'square', 'side'], required: true },
  description: { type: String, default: '', trim: true, maxlength: 240 },
  active: { type: Boolean, default: true, index: true },
  durationPrices: { type: [adDurationPriceSchema], default: [] },
  reservedUntil: { type: Date, default: null },
  holdCampaign: { type: mongoose.Schema.Types.ObjectId, default: null },
  holdExpiresAt: { type: Date, default: null },
}, { timestamps: true });

const AdPlacement = mongoose.model('AdPlacement', adPlacementSchema);

export default AdPlacement;
