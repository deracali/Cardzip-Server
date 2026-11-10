import mongoose from 'mongoose';

const telegramSignupSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, expires: 0 },
  sentAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('TelegramSignup', telegramSignupSchema);
