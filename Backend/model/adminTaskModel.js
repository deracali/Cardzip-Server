import mongoose from 'mongoose';

const adminTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  assignmentType: { type: String, enum: ['general', 'gift_card', 'store_order', 'support_request'], default: 'general', index: true },
  relatedGiftCard: { type: mongoose.Schema.Types.ObjectId, ref: 'GiftCard', default: null, index: true },
  relatedStoreOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreOrder', default: null, index: true },
  relatedSupportRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportRequest', default: null, index: true },
  status: { type: String, enum: ['todo', 'in_progress', 'completed', 'cancelled'], default: 'todo' },
  dueAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('AdminTask', adminTaskSchema);
