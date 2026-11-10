import mongoose from 'mongoose';

const adCampaignSchema = new mongoose.Schema({
  advertiser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  placement: { type: mongoose.Schema.Types.ObjectId, ref: 'AdPlacement', required: true, index: true },
  placementKey: { type: String, required: true, trim: true, lowercase: true },
  placementName: { type: String, required: true, trim: true },
  platform: { type: String, enum: ['website', 'app'], required: true },
  months: { type: Number, enum: [1, 12], required: true },
  amount: { type: Number, required: true, min: 1 },
  title: { type: String, required: true, trim: true, maxlength: 90 },
  copy: { type: String, required: true, trim: true, maxlength: 220 },
  imageUrl: { type: String, required: true, trim: true, maxlength: 2048 },
  destinationUrl: { type: String, default: '', trim: true, maxlength: 2048 },
  startAt: { type: Date, required: true, index: true },
  endAt: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ['pending_payment', 'pending_review', 'approved', 'rejected', 'failed'],
    default: 'pending_payment',
    index: true,
  },
  paymentReference: { type: String, default: '', index: true },
  paidAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, default: '', trim: true, maxlength: 500 },
}, { timestamps: true });

adCampaignSchema.index({ placementKey: 1, status: 1, startAt: 1, endAt: 1 });
adCampaignSchema.index({ advertiser: 1, createdAt: -1 });

const AdCampaign = mongoose.model('AdCampaign', adCampaignSchema);

export default AdCampaign;
