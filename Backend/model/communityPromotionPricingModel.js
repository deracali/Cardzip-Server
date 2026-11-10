import mongoose from 'mongoose';

const communityPromotionPricingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'community-product-promotion' },
  durations: {
    type: [{
      key: { type: String, enum: ['day', 'week', 'month'], required: true },
      label: { type: String, required: true },
      days: { type: Number, enum: [1, 7, 30], required: true },
      price: { type: Number, min: 0, required: true, default: 0 },
    }],
    default: [
      { key: 'day', label: '1 day', days: 1, price: 0 },
      { key: 'week', label: '1 week', days: 7, price: 0 },
      { key: 'month', label: '1 month', days: 30, price: 0 },
    ],
    validate: (durations) => (
      Array.isArray(durations)
      && durations.length === 3
      && ['day', 'week', 'month'].every((key) => durations.some((duration) => duration.key === key))
    ),
  },
}, { timestamps: true });

export default mongoose.model('CommunityPromotionPricing', communityPromotionPricingSchema);
