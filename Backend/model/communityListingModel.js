import mongoose from 'mongoose';

const communityListingSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, default: 'General', trim: true, maxlength: 60 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  price: { type: Number, required: true, min: 0 },
  condition: { type: String, enum: ['brand_new', 'used'], default: 'brand_new' },
  isSold: { type: Boolean, default: false, index: true },
  phone: { type: String, required: true, trim: true, maxlength: 16 },
  imageUrl: { type: String, default: '', trim: true, maxlength: 2048 },
  images: { type: [{ type: String, trim: true, maxlength: 2048 }], default: [] },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sellerName: { type: String, required: true, trim: true, maxlength: 120 },
  isActive: { type: Boolean, default: true, index: true },
  moderationStatus: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
  moderationReason: { type: String, default: '', trim: true, maxlength: 500 },
  promotionExpiresAt: { type: Date, default: null, index: true },
}, { timestamps: true });

communityListingSchema.index({ isActive: 1, createdAt: -1 });
communityListingSchema.index({ isActive: 1, promotionExpiresAt: -1, createdAt: -1 });

const CommunityListing = mongoose.model('CommunityListing', communityListingSchema);

export default CommunityListing;