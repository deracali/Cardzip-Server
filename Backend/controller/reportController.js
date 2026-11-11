import mongoose from 'mongoose';
import CommunityListing from '../model/communityListingModel.js';
import Shop from '../model/shopModel.js';
import ShopProduct from '../model/shopProductModel.js';
import StoreProduct from '../model/storeProductModel.js';
import UserNotification from '../model/userNotificationModel.js';
import UserReport from '../model/userReportModel.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

const targetModels = {
  store_product: StoreProduct,
  shop: Shop,
  shop_product: ShopProduct,
  community_listing: CommunityListing,
};

const loadTarget = async (targetType, targetId) => {
  const Model = targetModels[targetType];
  if (!Model) return null;
  const target = await Model.findById(targetId).lean();
  if (!target) return null;

  let ownerId;
  let name = target.name || target.businessName || target.title || 'Listing';
  let parentName = '';
  if (targetType === 'shop') {
    ownerId = target.owner;
  } else if (targetType === 'store_product') {
    ownerId = target.owner;
  } else if (targetType === 'community_listing') {
    ownerId = target.seller;
  } else {
    const shop = await Shop.findById(target.shop).select('owner businessName').lean();
    ownerId = shop?.owner;
    parentName = shop?.businessName || '';
  }
  return {
    target,
    ownerId: ownerId ? String(ownerId) : '',
    summary: {
      id: String(target._id),
      name,
      slug: target.slug || '',
      category: target.category || '',
      ...(parentName ? { shopName: parentName } : {}),
      moderationStatus: target.moderationStatus || 'active',
      moderationReason: target.moderationReason || '',
      reason: target.moderationReason || '',
    },
  };
};

export const createUserReport = async (req, res) => {
  const { targetType, targetId } = req.body || {};
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const details = typeof req.body?.details === 'string' ? req.body.details.trim() : '';
  if (!Object.hasOwn(targetModels, targetType) || !mongoose.isValidObjectId(targetId)) {
    return res.status(400).json({ success: false, message: 'Choose a valid report target.' });
  }
  if (reason.length < 3 || reason.length > 200 || details.length > 2000) {
    return res.status(400).json({ success: false, message: 'Enter a report reason of 3 to 200 characters and optional details up to 2000 characters.' });
  }
  try {
    const targetInfo = await loadTarget(targetType, targetId);
    if (!targetInfo) return res.status(404).json({ success: false, message: 'The item you are reporting could not be found.' });
    if (targetInfo.ownerId && targetInfo.ownerId === String(req.authUserId)) {
      return res.status(400).json({ success: false, message: 'You cannot report your own item.' });
    }
    const existingReport = await UserReport.exists({
      reporter: req.authUserId,
      targetType,
      targetId,
      status: 'open',
    });
    if (existingReport) {
      return res.status(409).json({ success: false, message: 'You already have an open report for this item.' });
    }
    const report = await UserReport.create({
      reporter: req.authUserId,
      targetType,
      targetId,
      reason,
      details,
    });
    return res.status(201).json({ success: true, data: report });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'You already have an open report for this item.' });
    }
    console.error('Create user report error:', error);
    return res.status(500).json({ success: false, message: 'Could not submit your report.' });
  }
};

export const listAdminReports = async (req, res) => {
  const status = req.query.status === undefined ? 'open' : req.query.status;
  if (!['open', 'resolved', 'dismissed', 'all'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Choose open, resolved, dismissed, or all reports.' });
  }
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const filter = status === 'all' ? {} : { status };
    const [reports, totalItems] = await Promise.all([
      UserReport.find(filter).populate('reporter', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      UserReport.countDocuments(filter),
    ]);
    const data = await Promise.all(reports.map(async (report) => {
      const targetInfo = await loadTarget(report.targetType, report.targetId);
      return {
        ...report,
        target: targetInfo
          ? { _id: targetInfo.summary.id, ...targetInfo.summary }
          : {
            _id: String(report.targetId),
            id: String(report.targetId),
            name: 'Unavailable item',
            moderationStatus: 'unavailable',
            moderationReason: '',
            reason: '',
          },
      };
    }));
    return res.json({
      success: true,
      data,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List admin reports error:', error);
    return res.status(500).json({ success: false, message: 'Could not load reports.' });
  }
};

export const updateAdminReport = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid report ID.' });
  }
  const action = req.body?.action;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!['suspend', 'dismiss', 'restore'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Choose suspend, dismiss, or restore.' });
  }
  if (action === 'suspend' && (reason.length < 10 || reason.length > 500)) {
    return res.status(400).json({ success: false, message: 'A suspension reason of 10 to 500 characters is required.' });
  }
  if (reason.length > 500) {
    return res.status(400).json({ success: false, message: 'The moderation reason cannot exceed 500 characters.' });
  }

  try {
    const report = await UserReport.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
    if (['suspend', 'dismiss'].includes(action) && report.status !== 'open') {
      return res.status(409).json({ success: false, message: 'Only open reports can be suspended or dismissed.' });
    }

    const targetInfo = await loadTarget(report.targetType, report.targetId);
    if (action !== 'dismiss' && !targetInfo) {
      return res.status(404).json({ success: false, message: 'The reported item is no longer available.' });
    }
    if (action === 'restore' && (
      report.adminAction !== 'suspend'
      || targetInfo.target.moderationStatus !== 'suspended'
    )) {
      return res.status(409).json({ success: false, message: 'This report does not have an active suspension to restore.' });
    }

    if (action === 'suspend' || action === 'restore') {
      const Model = targetModels[report.targetType];
      await Model.updateOne(
        { _id: report.targetId },
        { $set: action === 'suspend'
          ? { moderationStatus: 'suspended', moderationReason: reason }
          : { moderationStatus: 'active', moderationReason: '' } },
      );
    }

    report.adminAction = action;
    report.adminReason = reason;
    report.resolvedBy = req.admin._id;
    report.resolvedAt = new Date();
    report.status = action === 'dismiss' ? 'dismissed' : 'resolved';
    await report.save();

    if (action === 'suspend' && targetInfo.ownerId) {
      try {
        await UserNotification.create({
          user: targetInfo.ownerId,
          eventKey: `report:${report._id}:suspended`,
          category: 'moderation',
          title: 'Your listing has been suspended',
          message: reason,
          reference: String(report.targetId),
          occurredAt: new Date(),
        });
      } catch (notificationError) {
        console.error('Could not save report moderation notification:', notificationError);
      }
    }

    return res.json({ success: true, data: report });
  } catch (error) {
    console.error('Update admin report error:', error);
    return res.status(500).json({ success: false, message: 'Could not update this report.' });
  }
};
