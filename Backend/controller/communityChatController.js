import mongoose from 'mongoose';
import CommunityConversation from '../model/communityConversationModel.js';
import CommunityListing from '../model/communityListingModel.js';
import CommunityMessage from '../model/communityMessageModel.js';
import User from '../model/userModel.js';
import { sendUserPushNotification } from './notificationService.js';

const getId = (value) => value && typeof value === 'object' && '_id' in value ? value._id : value;

const isParticipant = (conversation, userId) => (
  String(getId(conversation.buyer)) === String(userId)
  || String(getId(conversation.seller)) === String(userId)
);

export const startCommunityConversation = async (req, res) => {
  const listingId = req.body?.listingId;
  if (!mongoose.isValidObjectId(listingId)) {
    return res.status(400).json({ success: false, message: 'Choose a valid community listing.' });
  }
  try {
    const listing = await CommunityListing.findOne({
      _id: listingId,
      isActive: true,
      moderationStatus: { $ne: 'suspended' },
      isSold: false,
    })
      .select('_id seller').lean();
    if (!listing) return res.status(404).json({ success: false, message: 'This listing is unavailable for chat.' });
    if (String(listing.seller) === String(req.authUserId)) {
      return res.status(400).json({ success: false, message: 'You cannot start a chat with yourself.' });
    }
    let conversation;
    try {
      conversation = await CommunityConversation.findOneAndUpdate(
        { listing: listing._id, buyer: req.authUserId, seller: listing.seller },
        { $setOnInsert: { listing: listing._id, buyer: req.authUserId, seller: listing.seller } },
        { upsert: true, new: true, runValidators: true },
      ).populate('listing', 'title imageUrl images isSold');
    } catch (error) {
      if (error.code !== 11000) throw error;
      conversation = await CommunityConversation.findOne({
        listing: listing._id,
        buyer: req.authUserId,
        seller: listing.seller,
      }).populate('listing', 'title imageUrl images isSold');
    }
    return res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    console.error('Start community conversation error:', error);
    return res.status(500).json({ success: false, message: 'Could not start this conversation.' });
  }
};

export const listMyCommunityConversations = async (req, res) => {
  try {
    const conversations = await CommunityConversation.find({
      $or: [{ buyer: req.authUserId }, { seller: req.authUserId }],
    })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(100)
      .populate('listing', 'title imageUrl images isSold')
      .populate('buyer', 'name profileImage')
      .populate('seller', 'name profileImage')
      .lean();
    const conversationsWithUnreadCount = conversations.map((conversation) => ({
      ...conversation,
      unreadCount: String(conversation.buyer?._id) === String(req.authUserId)
        ? conversation.buyerUnreadCount || 0
        : conversation.sellerUnreadCount || 0,
    }));
    return res.json({ success: true, data: conversationsWithUnreadCount });
  } catch (error) {
    console.error('List community conversations error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your conversations.' });
  }
};

export const getCommunityConversationMessages = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Choose a valid conversation.' });
  }
  try {
    const conversation = await CommunityConversation.findById(req.params.id)
      .populate('listing', 'title imageUrl images isSold')
      .populate('buyer', 'name profileImage')
      .populate('seller', 'name profileImage')
      .lean();
    if (!conversation || !isParticipant(conversation, req.authUserId)) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }
    const messages = await CommunityMessage.find({ conversation: conversation._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('sender', 'name profileImage')
      .lean();
    return res.json({ success: true, data: { conversation, messages: messages.reverse() } });
  } catch (error) {
    console.error('Get community conversation error:', error);
    return res.status(500).json({ success: false, message: 'Could not load this conversation.' });
  }
};

export const markCommunityConversationRead = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Choose a valid conversation.' });
  }
  try {
    const conversation = await CommunityConversation.findById(req.params.id);
    if (!conversation || !isParticipant(conversation, req.authUserId)) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }
    const isBuyer = String(conversation.buyer) === String(req.authUserId);
    const unreadField = isBuyer
      ? 'buyerUnreadCount'
      : 'sellerUnreadCount';
    await CommunityConversation.updateOne(
      { _id: conversation._id, [isBuyer ? 'buyer' : 'seller']: req.authUserId },
      { $set: { [unreadField]: 0 } },
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('Mark community conversation read error:', error);
    return res.status(500).json({ success: false, message: 'Could not mark this conversation as read.' });
  }
};

export const sendCommunityMessage = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Choose a valid conversation.' });
  }
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body || body.length > 2000) {
    return res.status(400).json({ success: false, message: 'Messages must contain 1–2000 characters.' });
  }
  try {
    const conversation = await CommunityConversation.findById(req.params.id);
    if (!conversation || !isParticipant(conversation, req.authUserId)) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }
    const message = await CommunityMessage.create({
      conversation: conversation._id,
      sender: req.authUserId,
      body,
    });
    const recipientId = String(conversation.buyer) === String(req.authUserId)
      ? conversation.seller
      : conversation.buyer;
    const unreadField = String(recipientId) === String(conversation.buyer)
      ? 'buyerUnreadCount'
      : 'sellerUnreadCount';
    await CommunityConversation.updateOne(
      { _id: conversation._id },
      {
        $set: { lastMessage: body, lastMessageAt: message.createdAt },
        $inc: { [unreadField]: 1 },
      },
    );
    await message.populate('sender', 'name profileImage');
    void Promise.all([
      User.findById(recipientId).select('pushTokens'),
      CommunityListing.findById(conversation.listing).select('title'),
    ]).then(([recipient, listing]) => {
      if (!recipient?.pushTokens?.length) return;
      return sendUserPushNotification(recipient, {
        title: `New message about ${listing?.title || 'a community listing'}`,
        body: `${message.sender?.name || 'A Cardzip user'}: ${body.slice(0, 140)}`,
        data: {
          type: 'community_chat',
          conversationId: String(conversation._id),
          listingId: String(conversation.listing),
        },
      });
    }).catch((error) => console.error('Could not notify community chat recipient:', error));
    return res.status(201).json({ success: true, data: message });
  } catch (error) {
    console.error('Send community message error:', error);
    return res.status(500).json({ success: false, message: 'Could not send your message.' });
  }
};
