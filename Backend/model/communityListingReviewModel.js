import mongoose from 'mongoose';

const communityListingReviewSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityListing', required: true, index: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true, trim: true, maxlength: 1000 },
}, { timestamps: true });

communityListingReviewSchema.index({ listing: 1, reviewer: 1 }, { unique: true });
communityListingReviewSchema.index({ listing: 1, createdAt: -1 });

const CommunityListingReview = mongoose.model('CommunityListingReview', communityListingReviewSchema);

export default CommunityListingReview;