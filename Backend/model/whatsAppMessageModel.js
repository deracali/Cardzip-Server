import mongoose from 'mongoose';

const whatsAppMessageSchema = new mongoose.Schema({
  providerMessageId: { type: String, required: true, unique: true, index: true },
  waId: { type: String, required: true, index: true },
  senderName: { type: String, default: '' },
  type: { type: String, required: true },
  text: { type: String, default: '' },
  media: [{
    providerMediaId: { type: String, required: true },
    mimeType: { type: String, default: '' },
    sha256: { type: String, default: '' },
    filename: { type: String, default: '' },
    url: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'stored', 'failed'], default: 'pending' },
  }],
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
