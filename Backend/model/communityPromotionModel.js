import mongoose from 'mongoose';

const communityPromotionSchema = new mongoose.Schema({
  targetType: { type: String, enum: ['community_listing', 'digital_asset'], default: 'community_listing', index: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityListing', default: null, index: true },
  digitalAsset: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreProduct', default: null, index: true },
  advertiser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
  paymentReference: { type: String, required: true, trim: true },
  duration: { type: String, enum: ['day', 'week', 'month'], required: true },
  durationDays: { type: Number, enum: [1, 7, 30], required: true },
  amount: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['pending_review', 'active', 'rejected', 'expired'], default: 'pending_review', index: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  reviewNote: { type: String, default: '', trim: true, maxlength: 500 },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

communityPromotionSchema.pre('validate', function validatePromotionTarget(next) {
  const hasCommunityListing = Boolean(this.listing);
  const hasDigitalAsset = Boolean(this.digitalAsset);
  if (hasCommunityListing === hasDigitalAsset
    || (this.targetType === 'community_listing' && !hasCommunityListing)
    || (this.targetType === 'digital_asset' && !hasDigitalAsset)) {
    next(new Error('A promotion must target exactly one community listing or digital asset.'));
    return;
  }
  next();
});

communityPromotionSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('CommunityPromotion', communityPromotionSchema);
