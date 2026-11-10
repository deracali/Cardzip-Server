import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['credit', 'debit', 'withdrawal'], required: true },
  amount: { type: Number, required: true },
  vatAmount: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'NGN' },
  balanceBefore: { type: Number, default: 0 },
  balanceAfter: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  description: { type: String, default: '' },
  referenceType: { type: String, default: 'manual' },
  referenceId: { type: String, default: null },
  channel: { type: String, default: '' },
  providerFee: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

export default WalletTransaction;
