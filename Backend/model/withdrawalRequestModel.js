import mongoose from 'mongoose';

const withdrawalRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reference: { type: String, required: true, unique: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'NGN' },
  bankName: { type: String, required: true, trim: true },
  accountName: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
  status: { type: String, enum: ['failed', 'pending', 'approved', 'rejected', 'completed'], default: 'pending', index: true },
  riskStatus: { type: String, enum: ['clear', 'failed'], required: true },
  riskReason: { type: String, trim: true, default: '' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  reviewReason: { type: String, trim: true, default: '' },
  payoutReference: { type: String, trim: true, default: '' },
  refundedAmount: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

export default mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
