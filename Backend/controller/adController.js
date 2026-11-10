import { v2 as cloudinary } from 'cloudinary';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import AdCampaign from '../model/adCampaignModel.js';
import CampaignAnalyticsEvent from '../model/campaignAnalyticsEventModel.js';
import AdPlacement from '../model/adPlacementModel.js';
import { addCalendarMonths } from '../utils/advertising.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const DEFAULT_PLACEMENTS = [
  { key: 'web-home-hero', name: 'Homepage hero banner', platform: 'website', location: 'Website homepage — primary hero area', format: 'wide', description: 'High-visibility wide banner near the top of the Cardzip homepage.' },
  { key: 'web-shop-banner', name: 'Shop feature banner', platform: 'website', location: 'Website shop — between hero and product catalog', format: 'wide', description: 'A prominent banner for customers already browsing the Cardzip shop.' },
  { key: 'web-shop-sidebar', name: 'Shop side placement', platform: 'website', location: 'Website shop — sidebar placement', format: 'side', description: 'A compact, focused placement alongside shop products.' },
  { key: 'app-home-hero', name: 'App home banner', platform: 'app', location: 'Cardzip app — home screen', format: 'wide', description: 'Featured banner on the Cardzip mobile app home screen.' },
  { key: 'app-market-banner', name: 'App market banner', platform: 'app', location: 'Cardzip app — market screen', format: 'wide', description: 'Reach customers browsing the Cardzip mobile market.' },
];
const RETIRED_PLACEMENT_KEYS = ['web-home-left', 'web-home-right', 'web-left-rail', 'web-right-rail'];

const getCampaignDisplayStatus = (campaign, now = new Date()) => (
  campaign.status === 'approved' && campaign.endAt <= now ? 'expired' : campaign.status
);

const ensureDefaultPlacements = async () => {
  await Promise.all([
    ...DEFAULT_PLACEMENTS.map((placement) => AdPlacement.findOneAndUpdate(
      { key: placement.key },
      {
        $setOnInsert: {
          ...placement,
          active: false,
          durationPrices: [{ months: 1, price: 0 }, { months: 12, price: 0 }],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )),
    AdPlacement.updateMany({ key: { $in: RETIRED_PLACEMENT_KEYS } }, { $set: { active: false } }),
  ]);
};

const hasValidImageSignature = (buffer, mimetype) => {
  if (mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return mimetype === 'image/webp'
    && buffer.subarray(0, 4).toString() === 'RIFF'
    && buffer.subarray(8, 12).toString() === 'WEBP';
};

const getNextStartAt = (placement, now) => (
  placement.reservedUntil && placement.reservedUntil > now
    ? new Date(placement.reservedUntil)
    : new Date(now)
);

const normalizeHttpUrl = (value, label, optional = false) => {
  if (!value && optional) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return { error: `${label} must use an HTTP or HTTPS address.` };
    return url.toString();
  } catch {
    return { error: `Enter a valid ${label.toLowerCase()}.` };
  }
};

export const listAdPlacements = async (req, res) => {
  try {
    await ensureDefaultPlacements();
    const placements = await AdPlacement.find({ key: { $nin: RETIRED_PLACEMENT_KEYS } }).sort({ platform: 1, format: 1, name: 1 }).lean();
    const now = new Date();
    const data = placements.map((placement) => ({
      key: placement.key,
      name: placement.name,
      platform: placement.platform,
      location: placement.location,
      format: placement.format,
      description: placement.description,
      active: placement.active,
      durationPrices: placement.durationPrices,
      nextAvailableAt: getNextStartAt(placement, now),
      checkoutAvailable: !placement.holdCampaign || !placement.holdExpiresAt || placement.holdExpiresAt <= now,
      bookable: placement.active && placement.durationPrices.some((entry) => entry.price > 0),
    }));
    return res.json({ success: true, data });
  } catch (error) {
    console.error('List ad placements error:', error);
    return res.status(500).json({ success: false, message: 'Could not load advertising placements.' });
  }
};

export const getCurrentAd = async (req, res) => {
  const placementKey = String(req.params.key || '').trim().toLowerCase();
  if (RETIRED_PLACEMENT_KEYS.includes(placementKey)) {
    return res.json({ success: true, data: null });
  }
  try {
    const now = new Date();
    const campaign = await AdCampaign.findOne({
      placementKey,
      status: 'approved',
      startAt: { $lte: now },
      endAt: { $gt: now },
    }).select('title copy imageUrl destinationUrl placementKey placementName platform startAt endAt').lean();
    return res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Get current ad error:', error);
    return res.status(500).json({ success: false, message: 'Could not load this banner.' });
  }
};

export const uploadAdCreative = async (req, res) => {
  const image = req.files?.image;
  if (!image || Array.isArray(image)) {
    return res.status(400).json({ success: false, message: 'Choose one advertisement image.' });
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimetype) || image.size > 8 * 1024 * 1024) {
    return res.status(400).json({ success: false, message: 'Upload one JPEG, PNG, or WebP image up to 8 MB.' });
  }
  try {
    const fileBuffer = image.tempFilePath ? await fs.readFile(image.tempFilePath) : image.data;
    if (!hasValidImageSignature(fileBuffer, image.mimetype)) {
      return res.status(400).json({ success: false, message: 'The image contents do not match its file type.' });
    }
    const source = image.tempFilePath || `data:${image.mimetype};base64,${fileBuffer.toString('base64')}`;
    const uploaded = await cloudinary.uploader.upload(source, {
      folder: 'cardzip/advertisements',
      resource_type: 'image',
    });
    return res.status(201).json({ success: true, data: { url: uploaded.secure_url } });
  } catch (error) {
    console.error('Upload ad creative error:', error);
    return res.status(502).json({ success: false, message: 'Could not upload this banner image.' });
  }
};

export const listMyAdCampaigns = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const [campaigns, totalItems] = await Promise.all([
      AdCampaign.find({ advertiser: req.authUserId }).sort({ createdAt: -1 }).skip(skip).limit(limit)
        .populate('placement', 'format location').lean(),
      AdCampaign.countDocuments({ advertiser: req.authUserId }),
    ]);
    const eventCounts = campaigns.length ? await CampaignAnalyticsEvent.aggregate([
      { $match: { campaignType: 'ad_campaign', campaign: { $in: campaigns.map((campaign) => campaign._id) } } },
      { $group: { _id: { campaign: '$campaign', eventType: '$eventType' }, count: { $sum: 1 } } },
    ]) : [];
    const metricsByCampaign = new Map();
    eventCounts.forEach(({ _id, count }) => {
      const metrics = metricsByCampaign.get(String(_id.campaign)) || { impressions: 0, clicks: 0 };
      metrics[_id.eventType === 'impression' ? 'impressions' : 'clicks'] = count;
      metricsByCampaign.set(String(_id.campaign), metrics);
    });
    const now = new Date();
    const campaignsWithMetrics = campaigns.map((campaign) => {
      const metrics = metricsByCampaign.get(String(campaign._id)) || { impressions: 0, clicks: 0 };
      return {
        ...campaign,
        displayStatus: getCampaignDisplayStatus(campaign, now),
        ...metrics,
        clickThroughRate: metrics.impressions ? Number((metrics.clicks / metrics.impressions * 100).toFixed(2)) : 0,
      };
    });
    return res.json({
      success: true,
      data: campaignsWithMetrics,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List advertiser campaigns error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your advertisements.' });
  }
};

export const trackAdCampaignEvent = async (req, res) => {
  const { eventType, visitorId } = req.body || {};
  if (!mongoose.isValidObjectId(req.params.id)
    || !['impression', 'click'].includes(eventType)
    || typeof visitorId !== 'string'
    || !/^[\w-]{16,80}$/.test(visitorId)) {
    return res.status(400).json({ success: false, message: 'Provide a valid campaign event.' });
  }
  try {
    const now = new Date();
    const campaign = await AdCampaign.findOne({
      _id: req.params.id,
      status: 'approved',
      startAt: { $lte: now },
      endAt: { $gt: now },
    }).select('_id').lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'This campaign is not active.' });
    try {
      if (eventType === 'click') {
        try {
          await CampaignAnalyticsEvent.create({
            campaignType: 'ad_campaign',
            campaign: campaign._id,
            eventType: 'impression',
            visitorId,
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
      await CampaignAnalyticsEvent.create({
        campaignType: 'ad_campaign',
        campaign: campaign._id,
        eventType,
        visitorId,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Track advertisement event error:', error);
    return res.status(500).json({ success: false, message: 'Could not record advertisement activity.' });
  }
};

export const createAdCampaignCheckout = async (req, res) => {
  const placementKey = typeof req.body.placementKey === 'string' ? req.body.placementKey.trim().toLowerCase() : '';
  const months = Number(req.body.months);
  const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 90) : '';
  const copy = typeof req.body.copy === 'string' ? req.body.copy.trim().slice(0, 220) : '';
  const imageUrl = normalizeHttpUrl(req.body.imageUrl, 'Image URL');
  const destinationUrl = normalizeHttpUrl(req.body.destinationUrl || '', 'Destination URL', true);
  if (!placementKey || ![1, 12].includes(months) || title.length < 3 || copy.length < 8) {
    return res.status(400).json({ success: false, message: 'Select a placement and duration, then enter a clear headline and description.' });
  }
  if (RETIRED_PLACEMENT_KEYS.includes(placementKey)) {
    return res.status(400).json({ success: false, message: 'This ad placement is no longer available.' });
  }
  if (typeof imageUrl !== 'string') return res.status(400).json({ success: false, message: imageUrl.error });
  if (typeof destinationUrl !== 'string') return res.status(400).json({ success: false, message: destinationUrl.error });
  if (!/^https:\/\//i.test(imageUrl)) return res.status(400).json({ success: false, message: 'The advertisement image must use a secure HTTPS URL.' });

  let campaignId;
  let placementId;
  try {
    const now = new Date();
    const placement = await AdPlacement.findOne({ key: placementKey, active: true });
    if (!placement) return res.status(404).json({ success: false, message: 'This advertising placement is not available.' });
    const price = placement.durationPrices.find((entry) => entry.months === months)?.price;
    if (!Number.isSafeInteger(price) || price <= 0) {
      return res.status(400).json({ success: false, message: 'This placement does not have an available price for the selected duration.' });
    }
    if (placement.holdCampaign && placement.holdExpiresAt > now) {
      return res.status(409).json({ success: false, message: 'Someone is checking out this placement. Please try again shortly.' });
    }
    const startAt = getNextStartAt(placement, now);
    const endAt = addCalendarMonths(startAt, months);
    const campaign = new AdCampaign({
      advertiser: req.authUserId,
      placement: placement._id,
      placementKey: placement.key,
      placementName: placement.name,
      platform: placement.platform,
      months,
      amount: price,
      title,
      copy,
      imageUrl,
      destinationUrl,
      startAt,
      endAt,
      status: 'pending_payment',
    });
    if (placement.holdCampaign && (!placement.holdExpiresAt || placement.holdExpiresAt <= now)) {
      await AdCampaign.updateOne(
        { _id: placement.holdCampaign, status: 'pending_payment' },
        { $set: { status: 'failed', reviewNote: 'Checkout reservation expired before payment.' } },
      );
    }
    const claim = await AdPlacement.updateOne({
      _id: placement._id,
      active: true,
      reservedUntil: placement.reservedUntil ?? null,
      $or: [
        { holdCampaign: null },
        { holdCampaign: { $exists: false } },
        { holdExpiresAt: { $lte: now } },
      ],
    }, {
      $set: {
        holdCampaign: campaign._id,
        holdExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      },
    });
    if (claim.modifiedCount !== 1) {
      return res.status(409).json({ success: false, message: 'This placement just became unavailable. Refresh the available placements and try again.' });
    }
    placementId = placement._id;
    campaignId = campaign._id;
    await campaign.save();
    return res.status(201).json({
      success: true,
      data: {
        campaignId: String(campaign._id),
        placementKey,
        placementName: placement.name,
        months,
        amount: price,
        startAt,
        endAt,
      },
    });
  } catch (error) {
    console.error('Reserve advertisement placement error:', error);
    if (campaignId && placementId) {
      await Promise.all([
        AdCampaign.deleteOne({ _id: campaignId, status: 'pending_payment' }),
        AdPlacement.updateOne({ _id: placementId, holdCampaign: campaignId }, { $set: { holdCampaign: null, holdExpiresAt: null } }),
      ]).catch((cleanupError) => console.error('Could not release failed advertisement hold:', cleanupError));
    }
    return res.status(500).json({ success: false, message: 'Could not reserve this advertisement placement.' });
  }
};

export const listAdminPlacements = async (req, res) => {
  try {
    await ensureDefaultPlacements();
    const placements = await AdPlacement.find({ key: { $nin: RETIRED_PLACEMENT_KEYS } }).sort({ platform: 1, format: 1, name: 1 }).lean();
    return res.json({ success: true, data: placements });
  } catch (error) {
    console.error('List admin ad placements error:', error);
    return res.status(500).json({ success: false, message: 'Could not load banner placements.' });
  }
};

export const updateAdminPlacement = async (req, res) => {
  if (RETIRED_PLACEMENT_KEYS.includes(String(req.params.key || '').trim().toLowerCase())) {
    return res.status(404).json({ success: false, message: 'Banner placement not found.' });
  }
  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 240) : '';
  const active = req.body.active;
  const durationPrices = req.body.durationPrices;
  if (!name || typeof active !== 'boolean' || !Array.isArray(durationPrices)) {
    return res.status(400).json({ success: false, message: 'Provide a placement name, availability, and duration prices.' });
  }
  const normalizedPrices = [1, 12].map((months) => {
    const entry = durationPrices.find((item) => Number(item.months) === months);
    return { months, price: Number(entry?.price) };
  });
  if (normalizedPrices.some((entry) => !Number.isSafeInteger(entry.price) || entry.price < 0)
    || (active && normalizedPrices.every((entry) => entry.price === 0))) {
    return res.status(400).json({ success: false, message: 'Enter valid whole-naira prices and set a price before enabling this placement.' });
  }
  try {
    const placement = await AdPlacement.findOneAndUpdate(
      { key: req.params.key },
      { $set: { name, description, active, durationPrices: normalizedPrices } },
      { new: true, runValidators: true },
    );
    if (!placement) return res.status(404).json({ success: false, message: 'Banner placement not found.' });
    return res.json({ success: true, data: placement });
  } catch (error) {
    console.error('Update ad placement error:', error);
    return res.status(500).json({ success: false, message: 'Could not save banner placement settings.' });
  }
};

export const listAdminCampaigns = async (req, res) => {
  const status = ['pending_review', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending_review';
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const [campaigns, totalItems] = await Promise.all([
      AdCampaign.find({ status }).populate('advertiser', 'name email').populate('placement', 'format location')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AdCampaign.countDocuments({ status }),
    ]);
    const eventCounts = campaigns.length ? await CampaignAnalyticsEvent.aggregate([
      { $match: { campaignType: 'ad_campaign', campaign: { $in: campaigns.map((campaign) => campaign._id) } } },
      { $group: { _id: { campaign: '$campaign', eventType: '$eventType' }, count: { $sum: 1 } } },
    ]) : [];
    const metricsByCampaign = new Map();
    eventCounts.forEach(({ _id, count }) => {
      const metrics = metricsByCampaign.get(String(_id.campaign)) || { impressions: 0, clicks: 0 };
      metrics[_id.eventType === 'impression' ? 'impressions' : 'clicks'] = count;
      metricsByCampaign.set(String(_id.campaign), metrics);
    });
    const now = new Date();
    const campaignsWithMetrics = campaigns.map((campaign) => {
      const metrics = metricsByCampaign.get(String(campaign._id)) || { impressions: 0, clicks: 0 };
      return {
        ...campaign,
        displayStatus: getCampaignDisplayStatus(campaign, now),
        ...metrics,
        clickThroughRate: metrics.impressions ? Number((metrics.clicks / metrics.impressions * 100).toFixed(2)) : 0,
      };
    });
    return res.json({
      success: true,
      data: campaignsWithMetrics,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List admin campaigns error:', error);
    return res.status(500).json({ success: false, message: 'Could not load advertising campaigns.' });
  }
};

export const reviewAdCampaign = async (req, res) => {
  const status = req.body.status;
  const reviewNote = typeof req.body.reviewNote === 'string' ? req.body.reviewNote.trim().slice(0, 500) : '';
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Choose approved or rejected as the review result.' });
  }
  if (status === 'rejected' && reviewNote.length < 5) {
    return res.status(400).json({ success: false, message: 'Add a short reason when rejecting an advertisement.' });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Advertisement campaign is invalid.' });
  }
  try {
    const campaign = await AdCampaign.findOneAndUpdate(
      { _id: req.params.id, status: 'pending_review' },
      { $set: { status, reviewNote, reviewedAt: new Date() } },
      { new: true, runValidators: true },
    ).populate('advertiser', 'name email').populate('placement', 'format location');
    if (!campaign) return res.status(404).json({ success: false, message: 'Pending advertisement campaign not found.' });
    return res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Review ad campaign error:', error);
    return res.status(500).json({ success: false, message: 'Could not review this advertisement.' });
  }
};
