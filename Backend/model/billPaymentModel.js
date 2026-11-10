import mongoose from 'mongoose';

const billPaymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  telegramChatId: { type: String, default: '', index: true },
  reference: { type: String, required: true, unique: true, index: true },
  paymentMethod: { type: String, enum: ['wallet', 'paystack'], required: true },
  category: { type: String, required: true },
  serviceID: { type: String, required: true },
  serviceName: { type: String, required: true },
  variationCode: { type: String, default: '' },
  packageName: { type: String, default: '' },
  billersCode: { type: String, required: true },
  phone: { type: String, required: true },
  customerName: { type: String, default: '' },
  customerAddress: { type: String, default: '' },
  amount: { type: Number, required: true, min: 1 },
  quantity: { type: Number, default: 1 },
  currency: { type: String, default: 'NGN' },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending', index: true },
  providerRequestId: { type: String, required: true, unique: true },
  providerReference: { type: String, default: '' },
  providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  failureReason: { type: String, default: '' },
  refundStatus: { type: String, enum: ['not_required', 'pending', 'completed', 'failed'], default: 'not_required' },
  refundReference: { type: String, default: '' },
  paystackReference: { type: String, default: '' },
  paystackTransactionId: { type: String, default: '' },
  telegramNotifiedStatus: { type: String, default: '' },
  walletTransactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction' }],
}, { timestamps: true });

billPaymentSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('BillPayment', billPaymentSchema);