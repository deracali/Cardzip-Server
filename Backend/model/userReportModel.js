import mongoose from 'mongoose';

const userReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: {
    type: String,
    enum: ['store_product', 'shop', 'shop_product', 'community_listing'],
    required: true,
  },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 200 },
  details: { type: String, default: '', trim: true, maxlength: 2000 },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
  adminAction: { type: String, enum: ['suspend', 'dismiss', 'restore'], default: null },
  adminReason: { type: String, default: '', trim: true, maxlength: 500 },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

userReportSchema.index(
  { reporter: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);
userReportSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('UserReport', userReportSchema);
