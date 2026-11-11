import { v2 as cloudinary } from 'cloudinary';
import fs from 'node:fs/promises';
import CommunityListing from '../model/communityListingModel.js';
import CommunityPromotion from '../model/communityPromotionModel.js';
import CampaignAnalyticsEvent from '../model/campaignAnalyticsEventModel.js';
import CommunityPromotionPricing from '../model/communityPromotionPricingModel.js';
import StoreProduct from '../model/storeProductModel.js';
import User from '../model/userModel.js';
import WalletTransaction from '../model/walletTransactionModel.js';
import mongoose from 'mongoose';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';
import { reverseCompanyProfit } from '../utils/companyLedger.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MAX_LISTING_IMAGES = 6;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasValidImageSignature = (buffer, mimetype) => {
  if (mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return mimetype === 'image/webp'
    && buffer.subarray(0, 4).toString() === 'RIFF'
    && buffer.subarray(8, 12).toString() === 'WEBP';
};

const getFileBuffer = (file) => file.tempFilePath
  ? fs.readFile(file.tempFilePath)
  : Promise.resolve(file.data);

const normalizePhone = (value) => {
  const phone = value.trim().replace(/[\s().-]/g, '');
  return /^\+?\d{7,15}$/.test(phone) ? phone : '';
};

const DEFAULT_PROMOTION_DURATIONS = [
  { key: 'day', label: '1 day', days: 1, price: 0 },
  { key: 'week', label: '1 week', days: 7, price: 0 },
  { key: 'month', label: '1 month', days: 30, price: 0 },
];

const ensurePromotionPricing = () => CommunityPromotionPricing.findOneAndUpdate(
  { key: 'community-product-promotion' },
  { $setOnInsert: { durations: DEFAULT_PROMOTION_DURATIONS } },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);

const parseListingPreferences = (rawPreferences) => {
  if (rawPreferences === undefined) return { categories: [], searches: [] };
  if (typeof rawPreferences !== 'string' || rawPreferences.length > 5000) {
    throw new Error('Product preferences are invalid.');
  }
  let preferences;
  try {
    preferences = JSON.parse(rawPreferences);
  } catch {
    throw new Error('Product preferences are invalid.');
  }
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw new Error('Product preferences are invalid.');
  }
  const categories = Array.isArray(preferences.categories)
    ? preferences.categories.slice(0, 20).flatMap((entry) => (
      typeof entry?.name === 'string' && entry.name.trim()
        ? [entry.name.trim().slice(0, 80).toLowerCase()]
        : []
    ))
    : [];
  const searches = Array.isArray(preferences.searches)
    ? preferences.searches.slice(0, 10).flatMap((entry) => {
      const term = typeof entry?.term === 'string' ? entry.term.trim().slice(0, 100).toLowerCase() : '';
      return term.length >= 3 ? [term] : [];
    })
    : [];
  return { categories, searches };
};

export const getCommunityListings = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const filter = { isActive: true, moderationStatus: { $ne: 'suspended' } };
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const { categories, searches } = parseListingPreferences(req.query.preferences);
    if (search) {
      const expression = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ title: expression }, { category: expression }, { description: expression }];
    }
    const searchableText = {
      $toLower: {
        $concat: [
          { $ifNull: ['$title', ''] },
          ' ',
          { $ifNull: ['$category', ''] },
          ' ',
          { $ifNull: ['$description', ''] },
        ],
      },
    };
    const interestMatches = [
      { $in: [{ $toLower: { $ifNull: ['$category', ''] } }, categories] },
      ...searches.map((term) => ({
        $gte: [{ $indexOfCP: [searchableText, term] }, 0],
      })),
    ];
    const hasInterestMatch = { $or: interestMatches };
    const [communityListings, promotedDigitalAssets, totalCommunityListings] = await Promise.all([
      CommunityListing.aggregate([
        { $match: filter },
        {
          $addFields: {
            interestRank: {
              $cond: [hasInterestMatch, 1, 0],
            },
            promotionRank: {
              $cond: [
                { $gt: ['$promotionExpiresAt', new Date()] },
                { $cond: [hasInterestMatch, 2, 1] },
                0,
              ],
            },
          },
        },
        { $sort: { promotionRank: -1, interestRank: -1, createdAt: -1 } },
        {
          $project: {
            title: 1,
            category: 1,
            description: 1,
            price: 1,
            condition: 1,
            isSold: 1,
            phone: 1,
            imageUrl: 1,
            images: 1,
            seller: 1,
            sellerName: 1,
            createdAt: 1,
            promotionExpiresAt: 1,
            isPromoted: { $gt: ['$promotionExpiresAt', new Date()] },
          },
        },
        { $limit: 5000 },
      ]),
      CommunityPromotion.find({
        targetType: 'digital_asset',
        status: 'active',
        endsAt: { $gt: new Date() },
      })
        .sort({ endsAt: -1, createdAt: -1 })
        .limit(1000)
        .populate({
          path: 'digitalAsset',
          match: { isActive: true, moderationStatus: { $ne: 'suspended' }, isSold: false, sellerListingStatus: 'approved' },
          select: '_id name slug productType category description price image createdAt promotionExpiresAt',
        })
        .lean(),
      CommunityListing.countDocuments(filter),
    ]);
    const now = new Date();
    const searchTerms = search.toLowerCase().split(/\s+/).filter(Boolean);
    const interestTerms = [...categories, ...searches].filter(Boolean);
    const seenDigitalAssets = new Set();
    const promotedListings = promotedDigitalAssets.flatMap((promotion) => {
      const asset = promotion.digitalAsset;
      if (!asset) return [];
      const assetId = String(asset._id);
      if (seenDigitalAssets.has(assetId)) return [];
      seenDigitalAssets.add(assetId);
      const searchableText = `${asset.name} ${asset.category} ${asset.description}`.toLowerCase();
      if (searchTerms.length && !searchTerms.every((term) => searchableText.includes(term))) return [];
      const matchingInterest = interestTerms.some((term) => searchableText.includes(term));
      return [{
        _id: assetId,
        promotionId: String(promotion._id),
        title: asset.name,
        category: asset.category,
        description: asset.description,
        price: asset.price,
        condition: 'brand_new',
        isSold: false,
        phone: '',
        imageUrl: asset.image || '',
        images: asset.image ? [asset.image] : [],
        sellerName: 'Cardzip digital marketplace',
        createdAt: asset.createdAt,
        promotionExpiresAt: asset.promotionExpiresAt || promotion.endsAt,
        isPromoted: true,
        isDigitalAsset: true,
        productType: asset.productType,
        slug: asset.slug,
        promotionRank: matchingInterest ? 3 : 2,
        interestRank: matchingInterest ? 1 : 0,
      }];
    });
    const combinedListings = [
      ...communityListings.map(({ seller, ...listing }) => ({
        ...listing,
        sellerId: String(seller),
        isDigitalAsset: false,
        promotionRank: listing.promotionRank || 0,
      })),
      ...promotedListings,
    ].sort((left, right) => (
      right.promotionRank - left.promotionRank
      || right.interestRank - left.interestRank
      || new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
    ));
    const listings = combinedListings.slice(skip, skip + limit);
    const publicListings = listings.map(({ promotionRank, interestRank, ...listing }) => listing);
    const totalItems = totalCommunityListings + promotedListings.length;
    return res.json({
      success: true,
      data: publicListings,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('Community listing query error:', error);
    return res.status(500).json({ success: false, message: 'Could not load community listings.' });
  }
};

export const listMyCommunityPromotions = async (req, res) => {
  try {
    const now = new Date();
    await CommunityPromotion.updateMany(
      { advertiser: req.authUserId, status: 'active', endsAt: { $lte: now } },
      { $set: { status: 'expired' } },
    );
    const promotions = await CommunityPromotion.find({ advertiser: req.authUserId })
      .sort({ createdAt: -1 })
      .populate('listing', 'title')
      .populate('digitalAsset', 'name')
      .lean();
    const eventCounts = promotions.length ? await CampaignAnalyticsEvent.aggregate([
      { $match: { campaignType: 'community_promotion', campaign: { $in: promotions.map((promotion) => promotion._id) } } },
      { $group: { _id: { campaign: '$campaign', eventType: '$eventType' }, count: { $sum: 1 } } },
    ]) : [];
    const metricsByPromotion = new Map();
    eventCounts.forEach(({ _id, count }) => {
      const metrics = metricsByPromotion.get(String(_id.campaign)) || { impressions: 0, clicks: 0 };
      metrics[_id.eventType === 'impression' ? 'impressions' : 'clicks'] = count;
      metricsByPromotion.set(String(_id.campaign), metrics);
    });
    const data = promotions.map((promotion) => {
      const metrics = metricsByPromotion.get(String(promotion._id)) || { impressions: 0, clicks: 0 };
      const target = promotion.targetType === 'digital_asset' ? promotion.digitalAsset : promotion.listing;
      return {
        ...promotion,
        displayStatus: promotion.status,
        targetName: target?.name || target?.title || 'Community listing',
        ...metrics,
        clickThroughRate: metrics.impressions ? Number((metrics.clicks / metrics.impressions * 100).toFixed(2)) : 0,
      };
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('List advertiser community promotions error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your community promotion performance.' });
  }
};

export const trackCommunityPromotionEvent = async (req, res) => {
  const { eventType, visitorId, targetId, targetType } = req.body || {};
  if (!mongoose.isValidObjectId(targetId)
    || !['community_listing', 'digital_asset'].includes(targetType)
    || !['impression', 'click'].includes(eventType)
    || typeof visitorId !== 'string'
    || !/^[\w-]{16,80}$/.test(visitorId)) {
    return res.status(400).json({ success: false, message: 'Provide a valid community promotion event.' });
  }
  try {
    const now = new Date();
    const promotion = await CommunityPromotion.findOne({
      targetType,
      [targetType === 'digital_asset' ? 'digitalAsset' : 'listing']: targetId,
      status: 'active',
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    }).select('_id').lean();
    if (!promotion) return res.status(404).json({ success: false, message: 'This community promotion is not active.' });
    try {
      if (eventType === 'click') {
        try {
          await CampaignAnalyticsEvent.create({
            campaignType: 'community_promotion',
            campaign: promotion._id,
            eventType: 'impression',
            visitorId,
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
      await CampaignAnalyticsEvent.create({
        campaignType: 'community_promotion',
        campaign: promotion._id,
        eventType,
        visitorId,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Track community promotion event error:', error);
    return res.status(500).json({ success: false, message: 'Could not record community promotion activity.' });
  }
};

export const getCommunityListing = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Provide a valid listing ID.' });
  }
  try {
    const listing = await CommunityListing.findOne({ _id: req.params.id, isActive: true })
      .select('title category description price condition isSold phone imageUrl images seller sellerName createdAt promotionExpiresAt moderationStatus')
      .populate('seller', 'profileImage')
      .lean();
    if (!listing) return res.status(404).json({ success: false, message: 'This community listing could not be found.' });
    if (listing.moderationStatus === 'suspended') {
      return res.status(404).json({ success: false, message: 'This community listing is unavailable.' });
    }
    delete listing.moderationStatus;
    const { seller, ...publicListing } = listing;
    return res.json({
      success: true,
      data: {
        ...publicListing,
        sellerId: String(seller?._id || seller),
        sellerImage: seller?.profileImage || '',
        isPromoted: Boolean(listing.promotionExpiresAt && listing.promotionExpiresAt > new Date()),
      },
    });
  } catch (error) {
    console.error('Community listing details error:', error);
    return res.status(500).json({ success: false, message: 'Could not load this community listing.' });
  }
};

export const getMyCommunityListings = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const filter = { seller: req.authUserId, isActive: true };
    const [listings, totalItems] = await Promise.all([
      CommunityListing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CommunityListing.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data: listings.map(({ seller, ...listing }) => ({
        ...listing,
        sellerId: String(seller),
        moderationStatus: listing.moderationStatus || 'active',
        moderationReason: listing.moderationReason || '',
      })),
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List own community listings error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your listings.' });
  }
};

export const getRelatedCommunityListings = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Provide a valid listing ID.' });
  }
  try {
    const listing = await CommunityListing.findOne({
      _id: req.params.id,
      isActive: true,
      moderationStatus: { $ne: 'suspended' },
    }).select('title category').lean();
    if (!listing) return res.status(404).json({ success: false, message: 'This community listing could not be found.' });
    const titleTerms = listing.title.split(/\s+/).filter((term) => term.length >= 3).slice(0, 5);
    const similarity = [];
    if (listing.category) similarity.push({ category: listing.category });
    for (const term of titleTerms) {
      similarity.push({ title: new RegExp(escapeRegex(term), 'i') });
    }
    if (!similarity.length) return res.json({ success: true, data: [] });
    const now = new Date();
    const related = await CommunityListing.aggregate([
      { $match: {
        _id: { $ne: new mongoose.Types.ObjectId(req.params.id) },
        isActive: true,
        moderationStatus: { $ne: 'suspended' },
        isSold: false,
        $or: similarity,
      } },
      {
        $addFields: {
          categoryRank: { $cond: [{ $eq: [{ $toLower: { $ifNull: ['$category', ''] } }, listing.category?.toLowerCase() || ''] }, 1, 0] },
          promotionRank: { $cond: [{ $gt: ['$promotionExpiresAt', now] }, 1, 0] },
        },
      },
      { $sort: { categoryRank: -1, promotionRank: -1, createdAt: -1 } },
      { $limit: 8 },
      {
        $project: {
          title: 1,
          category: 1,
          description: 1,
          price: 1,
          condition: 1,
          isSold: 1,
          imageUrl: 1,
          images: 1,
          seller: 1,
          sellerName: 1,
          createdAt: 1,
          promotionExpiresAt: 1,
          isPromoted: { $gt: ['$promotionExpiresAt', new Date()] },
        },
      },
    ]);
    return res.json({
      success: true,
      data: related.map(({ seller, ...item }) => ({ ...item, sellerId: String(seller) })),
    });
  } catch (error) {
    console.error('Related community listing query error:', error);
    return res.status(500).json({ success: false, message: 'Could not load similar community listings.' });
  }
};

export const getCommunityPromotionPricing = async (_req, res) => {
  try {
    const pricing = await ensurePromotionPricing();
    return res.json({ success: true, data: pricing.durations });
  } catch (error) {
    console.error('Load community promotion pricing error:', error);
    return res.status(500).json({ success: false, message: 'Could not load community promotion pricing.' });
  }
};

export const getAdminCommunityPromotionPricing = getCommunityPromotionPricing;

export const updateAdminCommunityPromotionPricing = async (req, res) => {
  const durations = req.body?.durations;
  if (!Array.isArray(durations) || durations.length !== 3) {
    return res.status(400).json({ success: false, message: 'Set prices for the 1-day, 1-week, and 1-month promotion packages.' });
  }
  const expectedDurations = new Map(DEFAULT_PROMOTION_DURATIONS.map((duration) => [duration.key, duration]));
  const normalizedDurations = [];
  for (const item of durations) {
    const fixedDuration = expectedDurations.get(item?.key);
    const price = Number(item?.price);
    if (!fixedDuration || !Number.isSafeInteger(price) || price < 0 || price > 1_000_000_000) {
      return res.status(400).json({ success: false, message: 'Promotion prices must be whole naira amounts of zero or more.' });
    }
    if (normalizedDurations.some((duration) => duration.key === fixedDuration.key)) {
      return res.status(400).json({ success: false, message: 'Each promotion duration must be set exactly once.' });
    }
    normalizedDurations.push({ ...fixedDuration, price });
  }
  try {
    const pricing = await CommunityPromotionPricing.findOneAndUpdate(
      { key: 'community-product-promotion' },
      { $set: { durations: normalizedDurations } },
      { upsert: true, new: true, runValidators: true },
    );
    return res.json({ success: true, data: pricing.durations });
  } catch (error) {
    console.error('Update community promotion pricing error:', error);
    return res.status(500).json({ success: false, message: 'Could not save community promotion pricing.' });
  }
};

export const listAdminCommunityPromotions = async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending_review';
  if (!['pending_review', 'active', 'rejected', 'expired'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Choose a valid community promotion status.' });
  }
  try {
    await CommunityPromotion.updateMany(
      { status: 'active', endsAt: { $lte: new Date() } },
      { $set: { status: 'expired' } },
    );
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const [promotions, totalItems] = await Promise.all([
      CommunityPromotion.find({ status })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('listing', 'title category price imageUrl images isSold promotionExpiresAt')
        .populate('digitalAsset', 'name slug productType category price image isSold sellerListingStatus promotionExpiresAt')
        .populate('advertiser', 'name email')
        .lean(),
      CommunityPromotion.countDocuments({ status }),
    ]);
    return res.json({
      success: true,
      data: promotions,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List admin community promotions error:', error);
    return res.status(500).json({ success: false, message: 'Could not load community promotion reviews.' });
  }
};

export const reviewAdminCommunityPromotion = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !['approved', 'rejected'].includes(req.body?.status)) {
    return res.status(400).json({ success: false, message: 'Provide a valid promotion and review decision.' });
  }
  const reviewNote = typeof req.body.reviewNote === 'string' ? req.body.reviewNote.trim().slice(0, 500) : '';
  const session = await mongoose.startSession();
  let reviewedPromotion;
  try {
    await session.withTransaction(async () => {
      const promotion = await CommunityPromotion.findOne({ _id: req.params.id, status: 'pending_review' }).session(session);
      if (!promotion) {
        const reviewError = new Error('This community promotion is no longer waiting for review.');
        reviewError.statusCode = 404;
        throw reviewError;
      }
      const isDigitalAssetPromotion = promotion.targetType === 'digital_asset' || Boolean(promotion.digitalAsset);
      const target = isDigitalAssetPromotion
        ? await StoreProduct.findOne({
          _id: promotion.digitalAsset,
          isActive: true,
          isSold: false,
          sellerListingStatus: 'approved',
          owner: promotion.advertiser,
        }).session(session)
        : await CommunityListing.findOne({
          _id: promotion.listing,
          isActive: true,
          moderationStatus: { $ne: 'suspended' },
        }).session(session);
      if (!target) {
        const reviewError = new Error('The listing is unavailable and cannot be promoted.');
        reviewError.statusCode = 409;
        throw reviewError;
      }
      promotion.reviewedAt = new Date();
      promotion.reviewNote = reviewNote;
      if (req.body.status === 'rejected') {
        promotion.status = 'rejected';
      } else {
        if (target.isSold) {
          const reviewError = new Error('A sold listing cannot be promoted.');
          reviewError.statusCode = 409;
          throw reviewError;
        }
        const now = new Date();
        const existingEnd = target.promotionExpiresAt && target.promotionExpiresAt > now
          ? target.promotionExpiresAt.getTime()
          : now.getTime();
        promotion.startsAt = new Date(existingEnd);
        promotion.endsAt = new Date(existingEnd + promotion.durationDays * 24 * 60 * 60 * 1000);
        promotion.status = 'active';
        target.promotionExpiresAt = promotion.endsAt;
        await target.save({ session });
      }
      await promotion.save({ session });
      reviewedPromotion = promotion;
    });
    const populatedPromotion = await CommunityPromotion.findById(reviewedPromotion._id)
      .populate('listing', 'title category price imageUrl images isSold promotionExpiresAt')
      .populate('digitalAsset', 'name slug productType category price image isSold sellerListingStatus promotionExpiresAt')
      .populate('advertiser', 'name email')
      .lean();
    return res.json({ success: true, data: populatedPromotion });
  } catch (error) {
    console.error('Review community promotion error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not review this community promotion.',
    });
  } finally {
    await session.endSession();
  }
};

export const createCommunityListing = async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
  const condition = req.body?.condition ?? 'brand_new';
  const rawIsSold = req.body?.isSold ?? false;
  const isSold = rawIsSold === true || rawIsSold === 'true'
    ? true
    : rawIsSold === false || rawIsSold === 'false' ? false : rawIsSold;
  const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone : '';
  const phone = normalizePhone(rawPhone);
  const uploadedFiles = req.files?.images;
  const imageFiles = !uploadedFiles ? [] : Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];
  const hasPrice = req.body?.price !== undefined && req.body?.price !== null && String(req.body.price).trim() !== '';
  const price = hasPrice ? Number(req.body.price) : Number.NaN;

  if (!title || title.length > 120) {
    return res.status(400).json({ success: false, message: 'Enter a product title of 1 to 120 characters.' });
  }
  if (!description || description.length > 2000) {
    return res.status(400).json({ success: false, message: 'Enter a description of 1 to 2,000 characters.' });
  }
  if (category.length > 60) {
    return res.status(400).json({ success: false, message: 'Category must be 60 characters or fewer.' });
  }
  if (!['brand_new', 'used'].includes(condition)) {
    return res.status(400).json({ success: false, message: 'Choose brand new or used condition.' });
  }
  if (typeof isSold !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Sold status must be true or false.' });
  }
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000_000) {
    return res.status(400).json({ success: false, message: 'Enter a valid price of zero or more.' });
  }
  if (!phone) {
    return res.status(400).json({ success: false, message: 'Enter a valid phone number, including the country code when needed.' });
  }
  if (imageFiles.length < 1 || imageFiles.length > MAX_LISTING_IMAGES) {
    return res.status(400).json({ success: false, message: `Upload between 1 and ${MAX_LISTING_IMAGES} product photos.` });
  }
  if (imageFiles.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || file.size > MAX_IMAGE_SIZE)) {
    return res.status(400).json({ success: false, message: 'Each photo must be a JPEG, PNG, or WebP image up to 8 MB.' });
  }

  const uploadedImages = [];
  try {
    const seller = await User.findById(req.authUserId).select('name').lean();
    if (!seller) return res.status(401).json({ success: false, message: 'Sign in again before posting a listing.' });
    const fileBuffers = await Promise.all(imageFiles.map(getFileBuffer));
    if (fileBuffers.some((buffer, index) => !hasValidImageSignature(buffer, imageFiles[index].mimetype))) {
      return res.status(400).json({ success: false, message: 'One or more photo contents do not match their file types.' });
    }
    for (const [index, file] of imageFiles.entries()) {
      const source = file.tempFilePath || `data:${file.mimetype};base64,${fileBuffers[index].toString('base64')}`;
      const upload = await cloudinary.uploader.upload(source, {
        folder: 'cardzip/community-listings',
        resource_type: 'image',
      });
      uploadedImages.push(upload);
    }
    const images = uploadedImages.map((image) => image.secure_url);
    const listing = await CommunityListing.create({
      title,
      category: category || 'General',
      description,
      price,
      condition,
      isSold,
      phone,
      imageUrl: images[0],
      images,
      seller: seller._id,
      sellerName: seller.name,
    });
    return res.status(201).json({ success: true, data: listing });
  } catch (error) {
    console.error('Community listing create error:', error);
    await Promise.all(uploadedImages.map((image) => cloudinary.uploader.destroy(image.public_id, { resource_type: 'image' })
      .catch((cleanupError) => console.error('Could not remove an unclaimed community listing photo:', cleanupError))));
    return res.status(500).json({ success: false, message: 'Could not publish your listing.' });
  }
};

export const updateCommunityListingStatus = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || typeof req.body?.isSold !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Provide a valid listing ID and sold status.' });
  }
  try {
    const listing = await CommunityListing.findOneAndUpdate(
      { _id: req.params.id, seller: req.authUserId },
      { $set: { isSold: req.body.isSold } },
      { new: true, runValidators: true },
    );
    if (!listing) return res.status(404).json({ success: false, message: 'Your listing could not be found.' });
    return res.json({ success: true, data: listing });
  } catch (error) {
    console.error('Community listing status update error:', error);
    return res.status(500).json({ success: false, message: 'Could not update this listing.' });
  }
};

export const updateCommunityListing = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Provide a valid listing ID.' });
  }
  const listing = await CommunityListing.findOne({ _id: req.params.id, seller: req.authUserId, isActive: true });
  if (!listing) return res.status(404).json({ success: false, message: 'Your listing could not be found.' });

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
  const condition = req.body?.condition ?? listing.condition;
  const rawIsSold = req.body?.isSold ?? listing.isSold;
  const isSold = rawIsSold === true || rawIsSold === 'true'
    ? true
    : rawIsSold === false || rawIsSold === 'false' ? false : rawIsSold;
  const phone = normalizePhone(typeof req.body?.phone === 'string' ? req.body.phone : '');
  const hasPrice = req.body?.price !== undefined && req.body?.price !== null && String(req.body.price).trim() !== '';
  const price = hasPrice ? Number(req.body.price) : Number.NaN;
  const uploadedFiles = req.files?.images;
  const imageFiles = !uploadedFiles ? [] : Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];

  if (!title || title.length > 120 || !description || description.length > 2000) {
    return res.status(400).json({ success: false, message: 'Enter a title and description within the listed limits.' });
  }
  if (category.length > 60 || !['brand_new', 'used'].includes(condition) || typeof isSold !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Check the category, condition, and sold status.' });
  }
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000_000 || !phone) {
    return res.status(400).json({ success: false, message: 'Enter a valid price and phone number.' });
  }
  if (imageFiles.length > MAX_LISTING_IMAGES
    || imageFiles.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || file.size > MAX_IMAGE_SIZE)) {
    return res.status(400).json({ success: false, message: `Upload up to ${MAX_LISTING_IMAGES} JPEG, PNG, or WebP photos, each up to 8 MB.` });
  }

  const uploadedImages = [];
  try {
    if (imageFiles.length) {
      const fileBuffers = await Promise.all(imageFiles.map(getFileBuffer));
      if (fileBuffers.some((buffer, index) => !hasValidImageSignature(buffer, imageFiles[index].mimetype))) {
        return res.status(400).json({ success: false, message: 'One or more photo contents do not match their file types.' });
      }
      for (const [index, file] of imageFiles.entries()) {
        const source = file.tempFilePath || `data:${file.mimetype};base64,${fileBuffers[index].toString('base64')}`;
        uploadedImages.push(await cloudinary.uploader.upload(source, {
          folder: 'cardzip/community-listings',
          resource_type: 'image',
        }));
      }
      listing.images = uploadedImages.map((image) => image.secure_url);
      listing.imageUrl = listing.images[0] || '';
    }
    listing.title = title;
    listing.category = category || 'General';
    listing.description = description;
    listing.price = price;
    listing.condition = condition;
    listing.isSold = isSold;
    listing.phone = phone;
    await listing.save();
    return res.json({ success: true, data: listing });
  } catch (error) {
    console.error('Community listing edit error:', error);
    await Promise.all(uploadedImages.map((image) => cloudinary.uploader.destroy(image.public_id, { resource_type: 'image' })
      .catch((cleanupError) => console.error('Could not remove an unclaimed community listing photo:', cleanupError))));
    return res.status(500).json({ success: false, message: 'Could not update your listing.' });
  }
};

export const deleteCommunityListing = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Provide a valid listing ID.' });
  }
  const session = await mongoose.startSession();
  let refundedAmount = 0;
  try {
    await session.withTransaction(async () => {
      refundedAmount = 0;
      const listing = await CommunityListing.findOneAndUpdate(
        { _id: req.params.id, seller: req.authUserId, isActive: true },
        { $set: { isActive: false } },
        { new: true, session },
      );
      if (!listing) {
        const deleteError = new Error('Your listing could not be found.');
        deleteError.statusCode = 404;
        throw deleteError;
      }
      const now = new Date();
      const promotions = await CommunityPromotion.find({
        listing: listing._id,
        status: { $in: ['active', 'pending_review'] },
      }).session(session);
      const millisecondsPerDay = 24 * 60 * 60 * 1000;
      const refundLines = promotions.map((promotion) => {
        const durationMilliseconds = promotion.durationDays * millisecondsPerDay;
        const remainingMilliseconds = promotion.status === 'pending_review'
          ? durationMilliseconds
          : promotion.endsAt
            ? Math.max(0, promotion.endsAt.getTime() - Math.max(
              now.getTime(),
              promotion.startsAt?.getTime() ?? promotion.endsAt.getTime() - durationMilliseconds,
            ))
            : 0;
        const amount = Math.floor(promotion.amount * Math.min(1, remainingMilliseconds / durationMilliseconds));
        return { promotion, amount };
      }).filter(({ amount }) => amount > 0);

      if (refundLines.length > 0) {
        const seller = await User.findById(listing.seller).session(session);
        if (!seller) {
          const refundError = new Error('The seller wallet could not be found for promotion credit.');
          refundError.statusCode = 409;
          throw refundError;
        }
        const totalRefund = refundLines.reduce((total, line) => total + line.amount, 0);
        const currentBalance = Number(seller.walletBalance || 0);
        if (!Number.isSafeInteger(totalRefund)
          || !Number.isFinite(currentBalance)
          || Math.abs(currentBalance + totalRefund) > Number.MAX_SAFE_INTEGER) {
          throw new Error('The promotion credit amount exceeds the supported wallet balance range.');
        }
        seller.walletCurrency = seller.walletCurrency || 'NGN';
        let balance = currentBalance;
        const transactions = refundLines.map(({ promotion, amount }) => {
          const balanceBefore = balance;
          balance += amount;
          return {
            user: seller._id,
            type: 'credit',
            amount,
            currency: seller.walletCurrency,
            balanceBefore,
            balanceAfter: balance,
            status: 'completed',
            description: 'Store credit for canceled community promotion',
            referenceType: 'community_promotion_refund',
            referenceId: String(promotion._id),
          };
        });
        seller.walletBalance = balance;
        await seller.save({ session });
        await WalletTransaction.create(transactions, { session });
        for (const { promotion, amount } of refundLines) {
          await reverseCompanyProfit({
            referenceType: 'community_promotion',
            referenceId: promotion.paymentReference,
            basisAmount: amount,
          }, session);
        }
        refundedAmount = totalRefund;
      }

      await CommunityPromotion.updateMany(
        { listing: listing._id, status: 'active' },
        { $set: { status: 'expired', endsAt: now, reviewedAt: now, reviewNote: 'Listing removed by seller.' } },
      ).session(session);
      await CommunityPromotion.updateMany(
        { listing: listing._id, status: 'pending_review' },
        {
          $set: {
            status: 'rejected',
            reviewedAt: now,
            reviewNote: 'Listing removed by seller; unused promotion fee credited to seller wallet.',
          },
        },
      ).session(session);
    });
    return res.json({
      success: true,
      message: refundedAmount > 0
        ? `Your listing has been removed and ₦${refundedAmount.toLocaleString('en-NG')} credited to your wallet.`
        : 'Your listing has been removed.',
      data: { refundedAmount },
    });
  } catch (error) {
    console.error('Community listing delete error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Could not remove your listing.',
    });
  } finally {
    await session.endSession();
  }
};