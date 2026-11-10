import mongoose from 'mongoose';
import CommunityListing from '../model/communityListingModel.js';
import CommunityListingReview from '../model/communityListingReviewModel.js';

const findActiveListing = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return CommunityListing.findOne({ _id: id, isActive: true }).select('_id seller');
};

const formatReview = (review) => ({
  _id: String(review._id),
  rating: review.rating,
  comment: review.comment,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
  reviewer: review.reviewer ? {
    name: review.reviewer.name || 'Cardzip member',
    profileImage: review.reviewer.profileImage || '',
  } : { name: 'Cardzip member', profileImage: '' },
});

export const getCommunityListingReviews = async (req, res) => {
  const listing = await findActiveListing(req.params.id);
  if (!listing) return res.status(mongoose.isValidObjectId(req.params.id) ? 404 : 400).json({ success: false, message: 'This community listing could not be found.' });
  try {
    const [reviews, summary] = await Promise.all([
      CommunityListingReview.find({ listing: listing._id }).sort({ createdAt: -1 }).limit(50).populate('reviewer', 'name profileImage').lean(),
      CommunityListingReview.aggregate([
        { $match: { listing: listing._id } },
        { $group: { _id: null, averageRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } },
      ]),
    ]);
    const totals = summary[0] || { averageRating: 0, totalReviews: 0 };
    return res.json({
      success: true,
      data: {
        reviews: reviews.map(formatReview),
        averageRating: Math.round(totals.averageRating * 10) / 10,
        totalReviews: totals.totalReviews,
      },
    });
  } catch (error) {
    console.error('Community listing reviews error:', error);
    return res.status(500).json({ success: false, message: 'Could not load product reviews.' });
  }
};

export const getMyCommunityListingReview = async (req, res) => {
  const listing = await findActiveListing(req.params.id);
  if (!listing) return res.status(mongoose.isValidObjectId(req.params.id) ? 404 : 400).json({ success: false, message: 'This community listing could not be found.' });
  try {
    const review = await CommunityListingReview.findOne({ listing: listing._id, reviewer: req.authUserId })
      .populate('reviewer', 'name profileImage')
      .lean();
    return res.json({ success: true, data: review ? formatReview(review) : null });
  } catch (error) {
    console.error('Community listing own review error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your product review.' });
  }
};

export const upsertCommunityListingReview = async (req, res) => {
  const listing = await findActiveListing(req.params.id);
  if (!listing) return res.status(mongoose.isValidObjectId(req.params.id) ? 404 : 400).json({ success: false, message: 'This community listing could not be found.' });
  if (String(listing.seller) === req.authUserId) {
    return res.status(403).json({ success: false, message: 'You cannot review your own listing.' });
  }

  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length < 3 || comment.length > 1000) {
    return res.status(400).json({ success: false, message: 'Choose a rating from 1 to 5 and write a comment between 3 and 1000 characters.' });
  }

  try {
    const review = await CommunityListingReview.findOneAndUpdate(
      { listing: listing._id, reviewer: req.authUserId },
      { $set: { rating, comment } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).populate('reviewer', 'name profileImage');
    return res.json({ success: true, data: formatReview(review) });
  } catch (error) {
    console.error('Save community listing review error:', error);
    return res.status(500).json({ success: false, message: 'Could not save your product review.' });
  }
};