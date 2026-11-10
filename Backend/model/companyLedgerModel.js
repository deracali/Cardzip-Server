import mongoose from 'mongoose';

const companyLedgerSchema = new mongoose.Schema({
  referenceType: {
    type: String,
    enum: ['bill_payment', 'store_order', 'seller_digital_sale', 'banner_ad', 'community_promotion'],
    required: true,
  },
  referenceId: { type: String, required: true },
  basisAmount: { type: Number, required: true, min: 0 },
  profitRate: { type: Number, required: true },
  profitAmount: { type: Number, required: true, min: 0 },
  reversedAmount: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'NGN' },
}, { timestamps: true });

companyLedgerSchema.index({ referenceType: 1, referenceId: 1 }, { unique: true });

export default mongoose.model('CompanyLedger', companyLedgerSchema);
