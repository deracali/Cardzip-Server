import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reference: { type: String, required: true, unique: true },
  amount: { type: Number, required: true, min: 1 },
  vatAmount: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'NGN' },
  purpose: { type: String, enum: ['wallet_funding', 'store_order', 'banner_ad', 'community_promotion', 'digital_product', 'seller_digital_asset'], required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreOrder', default: null },
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'AdCampaign', default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending', index: true },
  authorizationUrl: { type: String, default: '' },
  providerReference: { type: String, default: '' },
  channel: { type: String, default: '' },
  providerFee: { type: Number, default: 0, min: 0 },
  failureReason: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Payment', paymentSchema);
