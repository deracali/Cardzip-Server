import mongoose from 'mongoose';

const userNotificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  eventKey: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  reference: { type: String, default: '' },
  route: { type: String, default: '' },
  occurredAt: { type: Date, required: true },
  readAt: { type: Date, default: null },
}, { timestamps: true });

userNotificationSchema.index({ user: 1, occurredAt: -1 });

export default mongoose.model('UserNotification', userNotificationSchema);
