import express from 'express';
import fileUpload from 'express-fileupload';
import {
  createCommunityListing,
  deleteCommunityListing,
  getCommunityListing,
  getCommunityListings,
  getCommunityPromotionPricing,
  getMyCommunityListings,
  getRelatedCommunityListings,
  listMyCommunityPromotions,
  trackCommunityPromotionEvent,
  updateCommunityListingStatus,
  updateCommunityListing,
} from '../controller/communityMarketController.js';
import {
  getCommunityListingReviews,
  getMyCommunityListingReview,
  upsertCommunityListingReview,
} from '../controller/communityListingReviewController.js';
import authenticateUser from '../middleware/authenticateUser.js';
import {
  getCommunityConversationMessages,
  listMyCommunityConversations,
  markCommunityConversationRead,
  sendCommunityMessage,
  startCommunityConversation,
} from '../controller/communityChatController.js';
const communityMarketRouter = express.Router();

communityMarketRouter.get('/promotions/pricing', getCommunityPromotionPricing);
communityMarketRouter.get('/promotions/mine', authenticateUser, listMyCommunityPromotions);
communityMarketRouter.post('/promotions/events', trackCommunityPromotionEvent);
communityMarketRouter.get('/conversations', authenticateUser, listMyCommunityConversations);
communityMarketRouter.post('/conversations', authenticateUser, startCommunityConversation);
communityMarketRouter.get('/conversations/:id/messages', authenticateUser, getCommunityConversationMessages);
communityMarketRouter.post('/conversations/:id/read', authenticateUser, markCommunityConversationRead);
communityMarketRouter.post('/conversations/:id/messages', authenticateUser, sendCommunityMessage);
communityMarketRouter.get('/listings/mine', authenticateUser, getMyCommunityListings);
communityMarketRouter.get('/listings', getCommunityListings);
communityMarketRouter.get('/listings/:id/related', getRelatedCommunityListings);
communityMarketRouter.get('/listings/:id/reviews/mine', authenticateUser, getMyCommunityListingReview);
communityMarketRouter.get('/listings/:id/reviews', getCommunityListingReviews);
communityMarketRouter.post('/listings/:id/reviews', authenticateUser, upsertCommunityListingReview);
communityMarketRouter.get('/listings/:id', getCommunityListing);
communityMarketRouter.post('/listings', authenticateUser, fileUpload({
  useTempFiles: true,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  abortOnLimit: true,
}), createCommunityListing);
communityMarketRouter.patch('/listings/:id/status', authenticateUser, updateCommunityListingStatus);
communityMarketRouter.patch('/listings/:id', authenticateUser, fileUpload({
  useTempFiles: true,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  abortOnLimit: true,
}), updateCommunityListing);
communityMarketRouter.delete('/listings/:id', authenticateUser, deleteCommunityListing);

export default communityMarketRouter;