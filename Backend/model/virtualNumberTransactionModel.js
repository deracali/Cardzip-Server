import mongoose from 'mongoose';

const virtualNumberTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reference: { type: String, required: true, unique: true, index: true },
  paymentMethod: { type: String, enum: ['wallet', 'paystack'], required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending', index: true },
  paymentStatus: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  fulfillmentStatus: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  refundStatus: { type: String, enum: ['not_required', 'pending', 'completed', 'failed'], default: 'not_required' },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'NGN' },
  appName: { type: String, required: true },
  area: { type: String, default: '' },
  duration: { type: String, default: '' },
  time: { type: Number, required: true },
  autoRenew: { type: Boolean, default: false },
  paystackReference: { type: String, default: '', index: true },
  authorizationUrl: { type: String, default: '' },
  providerReference: { type: String, default: '' },
  rentalId: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  failureReason: { type: String, default: '' },
  refundReference: { type: String, default: '' },
  walletTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
}, { timestamps: true });

virtualNumberTransactionSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('VirtualNumberTransaction', virtualNumberTransactionSchema);
