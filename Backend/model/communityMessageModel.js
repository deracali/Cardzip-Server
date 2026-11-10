import mongoose from 'mongoose';

const communityMessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityConversation', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  body: { type: String, required: true, trim: true, maxlength: 2000 },
}, { timestamps: true });

communityMessageSchema.index({ conversation: 1, createdAt: 1 });

export default mongoose.model('CommunityMessage', communityMessageSchema);
