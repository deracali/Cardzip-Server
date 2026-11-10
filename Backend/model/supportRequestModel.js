import mongoose from 'mongoose';

const supportMessageSchema = new mongoose.Schema({
  senderRole: { type: String, enum: ['user', 'staff', 'admin'], required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  message: { type: String, required: true, trim: true, maxlength: 4000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const supportRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subject: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 4000 },
  status: { type: String, enum: ['open', 'assigned', 'in_progress', 'resolved'], default: 'open', index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null, index: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  messages: { type: [supportMessageSchema], default: [] },
}, { timestamps: true });

supportRequestSchema.index({ user: 1, createdAt: -1 });
supportRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('SupportRequest', supportRequestSchema);
