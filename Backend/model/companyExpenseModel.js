import mongoose from 'mongoose';

const companyExpenseSchema = new mongoose.Schema({
  expenseType: {
    type: String,
    enum: ['staff_salary', 'render', 'google_console', 'ios_developer', 'website_domain'],
    required: true,
    index: true,
  },
  label: { type: String, required: true, trim: true, maxlength: 160 },
  periodKey: { type: String, required: true, trim: true },
  dedupeKey: { type: String, required: true, unique: true },
  amountNgn: { type: Number, required: true, min: 0.01 },
  status: { type: String, enum: ['paid'], default: 'paid', required: true },
  staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null, index: true },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  paidAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

companyExpenseSchema.index({ expenseType: 1, periodKey: 1, paidAt: -1 });

export default mongoose.model('CompanyExpense', companyExpenseSchema);
