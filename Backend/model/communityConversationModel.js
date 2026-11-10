import mongoose from 'mongoose';

const communityConversationSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityListing', required: true, index: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  lastMessage: { type: String, default: '', trim: true, maxlength: 2000 },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  buyerUnreadCount: { type: Number, default: 0, min: 0 },
  sellerUnreadCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

communityConversationSchema.index({ listing: 1, buyer: 1, seller: 1 }, { unique: true });
communityConversationSchema.index({ buyer: 1, lastMessageAt: -1 });
communityConversationSchema.index({ seller: 1, lastMessageAt: -1 });

export default mongoose.model('CommunityConversation', communityConversationSchema);
